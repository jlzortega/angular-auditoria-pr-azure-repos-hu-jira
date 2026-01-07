import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
// 👇 IMPORTACIONES OBLIGATORIAS
import { CommonModule } from '@angular/common'; 
import { FormsModule } from '@angular/forms';     

import { AzureDevopsService } from '../services/azure-devops.service';
import { environment } from '../../environments/environment';
import { GitRepository, GitCommit, HuResult, AzurePullRequest } from '../models/azure.models';
import { forkJoin, switchMap, of, finalize, catchError } from 'rxjs';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
  standalone: true, // ✅ Componente autónomo
  imports: [
    CommonModule, // ✅ Soluciona *ngIf, *ngFor y el pipe | slice
    FormsModule   // ✅ Soluciona [(ngModel)]
  ]
})
export class DashboardComponent implements OnInit {
  
  // Datos
  repositories: GitRepository[] = [];
  branches: string[] = [];
  
  // Selección
  selectedRepoName: string = ''; 
  sourceBranch: string = '';
  targetBranch: string = '';

  // Resultados
  processedHUs: HuResult[] = [];
  commitsWithoutHU: GitCommit[] = [];
  
  // Estados de UI
  loadingStates = {
    repos: true,
    branches: false,
    analysis: false
  };
  errorMessage = '';

 constructor(
    private azureService: AzureDevopsService,
    private cdr: ChangeDetectorRef // 👈 2. Inyectar
  ) {}

  ngOnInit() {
    this.loadRepositories();
  }

  loadRepositories() {
    this.loadingStates.repos = true;
    this.azureService.getRepositories().subscribe({
      next: (repos) => {
        this.repositories = repos;
        console.log(repos);
        if (repos.length > 0) {
          const defaultRepo = repos.find(r => r.name === 'Juridico') || repos[0];
          this.onRepoChange(defaultRepo.name);
        }
        this.loadingStates.repos = false;

        this.cdr.detectChanges();
      },
      error: (err) => this.handleError('Error cargando repositorios', err)
    });
  }

  onRepoChange(repoName: string) {
    this.selectedRepoName = repoName;
    this.branches = [];
    this.sourceBranch = '';
    this.targetBranch = '';
    this.loadingStates.branches = true;

    this.azureService.getBranches(repoName).subscribe({
      next: (branches) => {
        this.branches = branches;
        this.autoSelectBranches(branches);
        this.loadingStates.branches = false;
      },
      error: (err) => this.handleError('Error cargando ramas', err)
    });
  }

  autoSelectBranches(branches: string[]) {
    if (branches.includes('develop')) this.sourceBranch = 'develop';
    else if (branches.includes('main')) this.sourceBranch = 'main';
    
    if (branches.includes('QA')) this.targetBranch = 'QA';
    else if (branches.includes('master')) this.targetBranch = 'master';
  }

  private handleError(msg: string, err: any) {
    console.error(err);
    this.loadingStates.repos = false;
    this.loadingStates.branches = false;
    this.loadingStates.analysis = false;
    this.errorMessage = `${msg}. Verifica permisos, CORS o conexión.`;
  }

  compareBranches() {
    if (!this.selectedRepoName || !this.sourceBranch || !this.targetBranch) return;

    this.loadingStates.analysis = true;
    this.errorMessage = '';
    this.processedHUs = [];
    this.commitsWithoutHU = [];
    
    console.log('1. Iniciando análisis de ramas...');

    this.azureService.getCommitsDiff(this.selectedRepoName, this.sourceBranch, this.targetBranch)
      .pipe(
        switchMap((commits: GitCommit[]) => {
          console.log(`2. Diferencia encontrada: ${commits.length} commits.`);
          
          if (commits.length === 0) {
            return of([]); 
          }

          // Extraemos IDs
          const commitIds = commits.map(c => c.commitId);
          console.log('3. Consultando PRs para los commits...', commitIds);
          
          // Solicitamos los PRs
          return this.azureService.getPrsByCommitIds(this.selectedRepoName, commitIds);
        }),
        // ⚠️ Importante: finalize se ejecuta SIEMPRE, haya error o éxito
        finalize(() => {
          console.log('🏁 Finalizando proceso (quitando loader).');
          this.loadingStates.analysis = false;
          this.cdr.detectChanges(); // 👈 FORZAR ACTUALIZACIÓN DE VISTA
        }),
        catchError(err => {
          console.error('❌ Error crítico en el flujo:', err);
          this.handleError('Fallo al analizar PRs', err);
          return of([]);
        })
      )
      .subscribe((prs: AzurePullRequest[]) => {
        console.log('4. PRs recibidos en el componente:', prs);
        this.analyzePullRequests(prs);
      });
  }

  private analyzePullRequests(prs: AzurePullRequest[]) {
    // Si llegó null o undefined
    if (!prs) prs = [];

    const huMap = new Map<string, AzurePullRequest[]>();

    prs.forEach(pr => {
      // 🛡️ Protección contra nulos
      const title = pr.title || '';
      const desc = pr.description || '';
      const fullText = (title + ' ' + desc).toUpperCase();
      
      const matches = fullText.match(environment.huRegex);

      if (matches) {
        const uniqueMatches = [...new Set(matches)];
        uniqueMatches.forEach(hu => {
          // Limpiamos la HU (por si el regex trajo espacios extra)
          const cleanHu = hu.trim(); 
          if (!huMap.has(cleanHu)) {
            huMap.set(cleanHu, []);
          }
          huMap.get(cleanHu)?.push(pr);
        });
      }
    });

    this.processedHUs = Array.from(huMap.entries())
      .map(([id, prs]) => ({ id, prs }))
      .sort((a, b) => a.id.localeCompare(b.id));

    console.log('5. HUs procesadas:', this.processedHUs);
    
    // 👈 IMPORTANTE: Volvemos a refrescar la vista por si acaso
    this.cdr.detectChanges(); 
  }
}