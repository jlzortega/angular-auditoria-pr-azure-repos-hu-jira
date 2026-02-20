import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
// 👇 IMPORTACIONES OBLIGATORIAS
import { CommonModule } from '@angular/common'; 
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';    
// Angular Material modules
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';

import { AzureDevopsService } from '../services/azure-devops.service';
import { environment } from '../../environments/environment';
import { GitRepository, GitCommit, HuResult, AzurePullRequest } from '../models/azure.models';
import { forkJoin, switchMap, of, finalize, catchError, Subject, map } from 'rxjs';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
  standalone: true, // ✅ Componente autónomo
  imports: [
    CommonModule, // ✅ Soluciona *ngIf, *ngFor y el pipe | slice
    FormsModule,  // ✅ Soluciona [(ngModel)]
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatAutocompleteModule,
  ]
})
export class DashboardComponent implements OnInit {
  
  // Datos
  repositories: GitRepository[] = [];
  branches: string[] = [];
  // Autocomplete helpers (Material FormControls)
  repoControl = new FormControl('');
  sourceControl = new FormControl('');
  targetControl = new FormControl('');
  filteredRepos: GitRepository[] = [];
  filteredBranchesSource: string[] = [];
  filteredBranchesTarget: string[] = [];
  // Theme
  isDark = false;
  
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

    // set up reactive listeners for Material autocomplete
    this.repoControl.valueChanges.subscribe(q => {
      const term = (q || '').toString().toLowerCase().trim();
      if (!term) this.filteredRepos = this.repositories.slice(0, 50);
      else this.filteredRepos = this.repositories.filter(r => r.name.toLowerCase().includes(term)).slice(0, 50);
    });

    this.sourceControl.valueChanges.subscribe(q => {
      const term = (q || '').toString().toLowerCase().trim();
      if (!term) this.filteredBranchesSource = this.branches.slice(0, 50);
      else this.filteredBranchesSource = this.branches.filter(b => b.toLowerCase().includes(term)).slice(0, 50);
    });

    this.targetControl.valueChanges.subscribe(q => {
      const term = (q || '').toString().toLowerCase().trim();
      if (!term) this.filteredBranchesTarget = this.branches.slice(0, 50);
      else this.filteredBranchesTarget = this.branches.filter(b => b.toLowerCase().includes(term)).slice(0, 50);
    });

    // Theme: read preference
    try {
      const saved = localStorage.getItem('theme');
      this.isDark = saved === 'dark';
    } catch (e) { this.isDark = false; }
    this.applyTheme();
  }

  toggleTheme() {
    this.isDark = !this.isDark;
    try { localStorage.setItem('theme', this.isDark ? 'dark' : 'light'); } catch (e) {}
    this.applyTheme();
  }

  private applyTheme() {
    if (this.isDark) document.body.classList.add('dark');
    else document.body.classList.remove('dark');
  }

  loadRepositories() {
    this.loadingStates.repos = true;
    this.azureService.getRepositories().subscribe({
      next: (repos) => {
        this.repositories = repos;
        // inicializar filtros
          this.filteredRepos = this.repositories.slice(0, 50);
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
    // actualizar query y ocultar sugerencias
    this.repoControl.setValue(repoName, { emitEvent: false });
    this.filteredRepos = [];
    this.branches = [];
    this.sourceBranch = '';
    this.targetBranch = '';
    this.loadingStates.branches = true;

    this.azureService.getBranches(repoName).subscribe({
      next: (branches) => {
        this.branches = branches;
        // inicializar sugerencias de ramas
        this.filteredBranchesSource = this.branches.slice(0, 50);
        this.filteredBranchesTarget = this.branches.slice(0, 50);
        this.autoSelectBranches(branches);
        this.loadingStates.branches = false;
      },
      error: (err) => this.handleError('Error cargando ramas', err)
    });
  }

  selectRepo(name: string) {
    if (!name) return;
    this.repoControl.setValue(name, { emitEvent: false });
    this.filteredRepos = [];
    this.onRepoChange(name);
  }

  selectSourceBranch(branch: string) {
    if (!branch) return;
    this.sourceControl.setValue(branch, { emitEvent: false });
    this.sourceBranch = branch;
    this.filteredBranchesSource = [];
  }

  selectTargetBranch(branch: string) {
    if (!branch) return;
    this.targetControl.setValue(branch, { emitEvent: false });
    this.targetBranch = branch;
    this.filteredBranchesTarget = [];
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

      console.log('PR:', pr.pullRequestId, 'title:', title);

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

    console.log('HUs procesadas desde PRs:', this.processedHUs);

    // No buscamos HUs en commits — requerimos que las HUs estén en títulos de PRs.
    this.commitsWithoutHU = [];

    // 👈 IMPORTANTE: Volvemos a refrescar la vista por si acaso
    this.cdr.detectChanges(); 
  }
}