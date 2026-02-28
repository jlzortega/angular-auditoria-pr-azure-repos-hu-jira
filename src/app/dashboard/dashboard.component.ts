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
import { forkJoin, switchMap, of, finalize, catchError, Subject, map, firstValueFrom } from 'rxjs';

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
  selectedRepoId: string = '';
  sourceBranch: string = '';
  targetBranch: string = '';

  // Resultados
  processedHUs: HuResult[] = [];
  commitsWithoutHU: GitCommit[] = [];
  // Diagnostics
  lastCommitIds: string[] = [];
  lastPrsReturned: AzurePullRequest[] = [];
  lastTargetPrs: AzurePullRequest[] = [];
  showDiagnostics = false;
  // expose environment to template
  env = environment;
  lastSourceBranchPrs: AzurePullRequest[] = [];
  lastAllPrs: AzurePullRequest[] = [];
  lastSourceCommits: GitCommit[] = [];
  lastTargetCommits: GitCommit[] = [];
  sourceHusList: string[] = [];
  targetHusList: string[] = [];
  lastSelection: { repo?: string; source?: string; target?: string } = {};
  // Strict verification mode: run per-HU searchText verification
  strictMode = false;

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
  ) { }

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
      // Sincronizar variable cuando el usuario escribe
      this.sourceBranch = (q || '').toString().trim();
    });

    this.targetControl.valueChanges.subscribe(q => {
      const term = (q || '').toString().toLowerCase().trim();
      if (!term) this.filteredBranchesTarget = this.branches.slice(0, 50);
      else this.filteredBranchesTarget = this.branches.filter(b => b.toLowerCase().includes(term)).slice(0, 50);
      // Sincronizar variable cuando el usuario escribe
      this.targetBranch = (q || '').toString().trim();
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
    try { localStorage.setItem('theme', this.isDark ? 'dark' : 'light'); } catch (e) { }
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
        this.repoControl.enable();

        this.cdr.detectChanges();
      },
      error: (err) => {
        this.repoControl.enable();
        this.handleError('Error cargando repositorios', err);
      }
    });

    this.repoControl.disable();
  }

  async onRepoChange(repoName: string) {
    this.selectedRepoName = repoName;
    const found = this.repositories.find(r => r.name === repoName);
    this.selectedRepoId = found ? found.id : repoName;
    // actualizar query y ocultar sugerencias
    this.repoControl.setValue(repoName, { emitEvent: false });
    this.filteredRepos = [];
    this.branches = [];
    this.sourceBranch = '';
    this.targetBranch = '';
    this.loadingStates.branches = true;
    this.sourceControl.disable();
    this.targetControl.disable();

    try {
      const branches = await this.azureService.getBranches(this.selectedRepoId);
      this.branches = branches;
      // inicializar sugerencias de ramas
      this.filteredBranchesSource = this.branches.slice(0, 50);
      this.filteredBranchesTarget = this.branches.slice(0, 50);
      this.autoSelectBranches(branches);
      this.loadingStates.branches = false;
      this.sourceControl.enable();
      this.targetControl.enable();
    } catch (err) {
      this.handleError('Error cargando ramas', err);
      this.loadingStates.branches = false;
      this.sourceControl.enable();
      this.targetControl.enable();
    }
  }

  async selectRepo(repoOrName: GitRepository | string) {
    if (!repoOrName) return;
    if (typeof repoOrName === 'string') {
      const name = repoOrName;
      this.repoControl.setValue(name, { emitEvent: false });
      this.filteredRepos = [];
      await this.onRepoChange(name);
      return;
    }

    // If a repository object was provided, use its id explicitly
    const repo = repoOrName as GitRepository;
    this.repoControl.setValue(repo.name, { emitEvent: false });
    this.filteredRepos = [];
    this.selectedRepoName = repo.name;
    this.selectedRepoId = repo.id || repo.name;
    // Load branches for the selected repo id
    this.loadingStates.branches = true;
    this.sourceControl.disable();
    this.targetControl.disable();
    try {
      const branches = await this.azureService.getBranches(this.selectedRepoId);
      this.branches = branches;
      this.filteredBranchesSource = this.branches.slice(0, 50);
      this.filteredBranchesTarget = this.branches.slice(0, 50);
      this.autoSelectBranches(branches);
      this.loadingStates.branches = false;
      this.sourceControl.enable();
      this.targetControl.enable();
      this.cdr.detectChanges();
    } catch (err) {
      this.handleError('Error cargando ramas', err);
      this.loadingStates.branches = false;
      this.sourceControl.enable();
      this.targetControl.enable();
    }
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
    console.error(msg, err);
    this.loadingStates.repos = false;
    this.loadingStates.branches = false;
    this.loadingStates.analysis = false;
    let details = '';
    try {
      if (err) {
        if (err.status) details += ` HTTP ${err.status}`;
        if (err.message) details += ` - ${err.message}`;
        if (err.error && typeof err.error === 'string') details += ` - ${err.error}`;
      }
    } catch (e) { /* ignore */ }
    this.errorMessage = `${msg}. Verifica permisos, CORS o conexión.${details ? ' Detalle:' + details : ''}`;
  }

  compareBranches() {
    // Usar valores del FormControl para sincronizar con lo que ve el usuario
    const sourceBranch = (this.sourceControl.value || this.sourceBranch || '').toString().trim();
    const targetBranch = (this.targetControl.value || this.targetBranch || '').toString().trim();

    if (!this.selectedRepoId || !sourceBranch || !targetBranch) return;

    this.loadingStates.analysis = true;
    this.errorMessage = '';
    this.processedHUs = [];
    this.commitsWithoutHU = [];

    console.log('1. Iniciando análisis de ramas (método commit-centric)...');
    // Guardar selección para diagnóstico
    this.lastSelection = { repo: this.selectedRepoName, source: sourceBranch, target: targetBranch };

    // Validación básica
    if (sourceBranch === targetBranch) {
      this.handleError('La rama origen y la rama destino son iguales. Selecciona ramas distintas.', null);
      this.loadingStates.analysis = false;
      return;
    }

    // Sincronizar variables
    this.sourceBranch = sourceBranch;
    this.targetBranch = targetBranch;

    // Asegurarnos de pasar preferentemente el `repo.id` cuando esté disponible
    const repoIdentifier = this.selectedRepoId || this.selectedRepoName || '';
    console.debug('Diagnostic: calling getCommitsDiff with identifier:', repoIdentifier, 'source:', sourceBranch, 'target:', targetBranch);

    this.azureService.getCommitsDiff(repoIdentifier, sourceBranch, targetBranch)
      .pipe(
        switchMap((commits: GitCommit[]) => {
          console.log(`2. Diferencia encontrada por diff: ${commits.length} commits.`);

          return forkJoin({
            diffCommits: of(commits),
            sourceCommits: this.azureService.getCommitsForBranch(this.selectedRepoId, sourceBranch, 50).pipe(catchError(() => of([]))),
            // PRs asociados a los commits del diff
            diffPrs: commits.length > 0 ? this.azureService.getPrsByCommitIds(this.selectedRepoId, commits.map(c => c.commitId)) : of([]),
            // PRs que fueron terminados HACIA la rama origen (aquí es donde suelen estar las HUs)
            sourceMergedPrs: this.azureService.getPullRequestsForTarget(this.selectedRepoId, sourceBranch, 200).pipe(catchError(() => of([]))),
            // PRs que vienen DESDE la rama origen (activos)
            sourceActivePrs: this.azureService.getPrsBySourceBranch(this.selectedRepoId, sourceBranch).pipe(catchError(() => of([]))),
            // ÚLTIMO RECURSO: Buscar TODOS los PRs del repositorio (últimos 100)
            repoPullRequests: this.azureService.getAllPullRequests(this.selectedRepoId).pipe(catchError(() => of([])))
          });
        }),
        finalize(() => {
          console.log('🏁 Finalizando proceso (quitando loader).');
          this.loadingStates.analysis = false;
          this.cdr.detectChanges();
        }),
        catchError(err => {
          console.error('❌ Error crítico en el flujo:', err);
          this.handleError('Fallo al analizar PRs/Commits', err);
          return of({ commits: [], commitIds: [], prs: [], commitDetails: [] });
        })
      )
      .subscribe(async (results: any) => {
        if (!results) return;

        const { diffCommits, sourceCommits, diffPrs, sourceMergedPrs, sourceActivePrs, repoPullRequests } = results;
        const targetBranchLocal = this.targetBranch;

        console.log('📦 Descubrimiento:', {
          diff: (diffCommits || []).length,
          repoWide: (repoPullRequests || []).length,
          target: targetBranchLocal
        });

        const sourceHus = new Set<string>();
        const targetHus = new Set<string>();

        // 1. Clasificar Pull Requests del Repositorio (Modo Inteligente)
        (repoPullRequests || []).forEach((pr: AzurePullRequest) => {
          const status = ((pr as any).status || '').toLowerCase();
          const targetBranchName = (pr.targetRefName || '').replace('refs/heads/', '');
          const matches = this.getHuMatchesFromText(((pr.title || '') + ' ' + (pr.description || '')).toUpperCase());

          if (status === 'completed' || status === 'merged') {
            if (targetBranchName === targetBranchLocal) {
              // Si ya se completó hacia el destino final (Master), se marca como integrada
              matches.forEach(m => targetHus.add(m));
            } else if (targetBranchName === this.sourceBranch) {
              // Si llegó al origen (QA), pero NO al destino final, entonces está pendiente de pasar a Master
              matches.forEach(m => sourceHus.add(m));
            }
          } else if (status === 'active' && targetBranchName === targetBranchLocal) {
            // PR activa directamente hacia el destino final
            matches.forEach(m => sourceHus.add(m));
          }
        });

        // 2. Extraer de Pull Requests de descubrimiento
        const discoveryPrs = [...(diffPrs || []), ...(sourceMergedPrs || []), ...(sourceActivePrs || [])];
        discoveryPrs.forEach(pr => {
          if (!pr) return;
          const status = ((pr as any).status || '').toLowerCase();
          const matches = this.getHuMatchesFromText(((pr.title || '') + ' ' + (pr.description || '')).toUpperCase());

          if (status === 'active') {
            matches.forEach(m => sourceHus.add(m));
          } else if (status === 'completed' || status === 'merged') {
            const target = (pr.targetRefName || '').replace('refs/heads/', '');
            if (target === targetBranchLocal) {
              matches.forEach(m => targetHus.add(m));
            } else {
              matches.forEach(m => sourceHus.add(m));
            }
          }
        });

        // 3. Extraer de Commits Diferenciales
        (diffCommits || []).forEach((c: GitCommit) => {
          if (!c || !c.comment) return;
          const matches = this.getHuMatchesFromText(c.comment.toUpperCase());
          matches.forEach(m => sourceHus.add(m));
        });

        this.sourceHusList = Array.from(sourceHus).sort();
        console.log('HUs detectadas en ORIGEN:', this.sourceHusList);

        if (sourceHus.size === 0 && (diffCommits || []).length > 0) {
          // Si hay commits pero no detectamos HUs, marcar esos commits para atención
          this.commitsWithoutHU = (diffCommits || []).filter((c: GitCommit) => c && c.comment);
        }

        // 4. DEEP EXCLUSION
        try {
          const [tgtPrs, tgtCommits] = await firstValueFrom(forkJoin([
            this.azureService.getPullRequestsForTarget(this.selectedRepoId, targetBranchLocal, 1000).pipe(catchError(() => of([]))),
            this.azureService.getCommitsForBranch(this.selectedRepoId, targetBranchLocal, 1000).pipe(catchError(() => of([])))
          ]));

          this.lastTargetPrs = tgtPrs || [];
          this.lastTargetCommits = tgtCommits || [];

          (tgtPrs || []).forEach(tpr => {
            const matches = this.getHuMatchesFromText(((tpr.title || '') + ' ' + (tpr.description || '')).toUpperCase());
            matches.forEach(m => targetHus.add(m));
          });

          (tgtCommits || []).forEach(tc => {
            if (!tc || !tc.comment) return;
            const matches = this.getHuMatchesFromText(tc.comment.toUpperCase());
            matches.forEach(m => targetHus.add(m));
          });

          this.targetHusList = Array.from(targetHus).sort();
          console.log('HUs integradas en TARGET:', this.targetHusList);

          // 5. FILTRADO FINAL
          let finalHus = Array.from(sourceHus).filter(h => !targetHus.has(h));
          console.log(`📊 Análisis Final: ${finalHus.length} pendientes de ${sourceHus.size} encontradas.`);

          const uniquePrs = Array.from(new Map(discoveryPrs.filter(p => p?.pullRequestId).map(p => [p.pullRequestId, p])).values());
          this.lastPrsReturned = uniquePrs;
          const huMap = new Map<string, AzurePullRequest[]>();

          finalHus.forEach(h => {
            const prsWithHu = uniquePrs.filter(pr => {
              const text = ((pr.title || '') + ' ' + (pr.description || '')).toUpperCase();
              return text.includes(h);
            });
            huMap.set(h, prsWithHu);
          });

          this.processedHUs = Array.from(huMap.entries()).map(([id, prs]) => ({ id, prs })).sort((a, b) => a.id.localeCompare(b.id));
          this.cdr.detectChanges();

        } catch (err) {
          console.error('Error en análisis:', err);
          this.processedHUs = Array.from(sourceHus).map(id => ({ id, prs: [] }));
          this.cdr.detectChanges();
        }
      });
  }
  private buildExactHuRegex(): RegExp {
    const src = (environment.huRegex && (environment.huRegex as RegExp).source) ? (environment.huRegex as RegExp).source : 'JURP01-[A-Z0-9]+';
    // Quitamos los límites \b por ahora para ser más flexibles (algunos Jira keys vienen pegados a caracteres)
    return new RegExp(src, 'g');
  }

  private getHuMatchesFromText(text: string): string[] {
    if (!text) return [];
    const rx = this.buildExactHuRegex();
    const matches = text.match(rx) || [];
    return Array.from(new Set(matches.map(m => m.trim().toUpperCase())));
  }
}
