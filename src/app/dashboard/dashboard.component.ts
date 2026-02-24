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

    try {
      const branches = await this.azureService.getBranches(this.selectedRepoId);
      this.branches = branches;
      // inicializar sugerencias de ramas
      this.filteredBranchesSource = this.branches.slice(0, 50);
      this.filteredBranchesTarget = this.branches.slice(0, 50);
      this.autoSelectBranches(branches);
      this.loadingStates.branches = false;
    } catch (err) {
      this.handleError('Error cargando ramas', err);
      this.loadingStates.branches = false;
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
    try {
      const branches = await this.azureService.getBranches(this.selectedRepoId);
      this.branches = branches;
      this.filteredBranchesSource = this.branches.slice(0, 50);
      this.filteredBranchesTarget = this.branches.slice(0, 50);
      this.autoSelectBranches(branches);
      this.loadingStates.branches = false;
      this.cdr.detectChanges();
    } catch (err) {
      this.handleError('Error cargando ramas', err);
      this.loadingStates.branches = false;
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
      return;sourceBranch, 'target:', targetBranch);

    this.azureService.getCommitsDiff(repoIdentifier, sourceBranch, 
    // Sincronizar variables
    this.sourceBranch = sourceBranch;
    this.targetBranch = targetBranch;

    // Asegurarnos de pasar preferentemente el `repo.id` cuando esté disponible
    const repoIdentifier = this.selectedRepoId || this.selectedRepoName || '';
    console.debug('Diagnostic: calling getCommitsDiff with identifier:', repoIdentifier, 'source:', sourceBranch, 'target:', targetBranch);

    this.azureService.getCommitsDiff(repoIdentifier, sourceBranch, targetBranch)
      .pipe(
        switchMap((commits: GitCommit[]) => {
          console.log(`2. Diferencia encontrada: ${commits.length} commits.`);

          if (!commits || commits.length === 0) {
            // Si commitsBatch devuelve vacío, intentar listar commits directamente para diagnóstico
            this.lastCommitIds = [];
            return this.azureService.getCommitsForBranch(this.selectedRepoId, sourceBranch, 50).pipe(
              map((srcCommits: GitCommit[]) => {
                this.lastSourceCommits = srcCommits || [];
                return { commits: [], commitIds: [] as string[] };
              }),
              catchError(err => {
                console.warn('Error al listar commits de la rama source para diagnóstico:', err);
                return of({ commits: [], commitIds: [] as string[] });
              })
            );
          }

          const commitIds = commits.map(c => c.commitId);
          this.lastCommitIds = commitIds;

          // Obtener PRs asociados a esos commits (fallback aggregator) y los detalles de commits
          return forkJoin({
            prs: this.azureService.getPrsForCommitIdsFallback(this.selectedRepoId, commitIds).pipe(catchError(() => of([] as AzurePullRequest[]))),
            commitDetails: commitIds.length ? forkJoin(commitIds.map(id => this.azureService.getCommitDetail(this.selectedRepoId, id)).map(obs => obs.pipe(catchError(() => of(null))))) : of([])
          }).pipe(map(res => ({ commits, commitIds, prs: res.prs || [], commitDetails: res.commitDetails || [] })));
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
      .subscribe(async (payload: any) => {
        const commits: GitCommit[] = payload.commits || [];
        const commitIds: string[] = payload.commitIds || [];
        const prs: AzurePullRequest[] = payload.prs || [];
        const commitDetails: (GitCommit | null)[] = payload.commitDetails || [];
        const sourceBranchLocal = payload.sourceBranch || sourceBranch;
        const targetBranchLocal = payload.targetBranch || targetBranch;

        console.log('3. PRs asociados a commits (fallback):', prs.length);
        // Tighten PR selection: prefer PRs whose source or target branch matches the sourceBranch
        const filteredPrs = (prs || []).filter(pr => {
          if (!pr) return false;
          const src = (pr.sourceRefName || '').replace('refs/heads/', '');
          const tgt = (pr.targetRefName || '').replace('refs/heads/', '');
          const status = (pr as any).status || (pr as any).state || '';
          const isCompleted = typeof status === 'string' && status.toLowerCase() === 'completed';
          // Include PRs whose source is the sourceBranch (they were opened from source),
          // or PRs that are completed (to be considered for exclusion later).
          return src === sourceBranchLocal || isCompleted || tgt === sourceBranchLocal;
        });
        this.lastPrsReturned = filteredPrs;

        // Construir conjunto de HUs presentes en origen (extraídos de PRs que fueron integradas en la rama ORIGEN o de los mensajes de commit)
        const sourceHus = new Set<string>();

        // PRs asociados: solo considerar PRs cuyo target sea la rama origen (o PRs completados)
        (this.lastPrsReturned || []).forEach(pr => {
          const target = (pr.targetRefName || '').replace('refs/heads/', '');
          const status = (pr as any).status || (pr as any).state || '';
          const isCompleted = typeof status === 'string' && status.toLowerCase() === 'completed';
          if (target === sourceBranchLocal || isCompleted) {
            const text = ((pr.title || '') + ' ' + (pr.description || '')).toUpperCase();
            const matches = this.getHuMatchesFromText(text);
            if (matches && matches.length) matches.forEach(m => sourceHus.add(m));
          }
        });

        // Mensajes de commits: extraer HUs
        (commitDetails || []).forEach(cd => {
          if (!cd) return;
          const text = (cd.comment || '').toUpperCase();
          const matches = this.getHuMatchesFromText(text);
          if (matches && matches.length) matches.forEach(m => sourceHus.add(m));
        });

        console.log('HUs detectadas en ORIGEN (pre-exclusión):', Array.from(sourceHus));

        // Ahora obtener HUs presentes en target (PRs completados targeting targetBranch + commits in target branch)
        try {
          const [targetPrs, targetCommits] = await firstValueFrom(forkJoin([
            this.azureService.getPullRequestsForTarget(this.selectedRepoId, targetBranchLocal).pipe(catchError(() => of([] as AzurePullRequest[]))),
            this.azureService.getCommitsForBranch(this.selectedRepoId, targetBranchLocal, 500).pipe(catchError(() => of([] as GitCommit[]))).pipe(map((tc: GitCommit[]) => { this.lastTargetCommits = tc || []; return tc; }))
          ]));

          this.lastTargetPrs = targetPrs || [];

          const targetHus = new Set<string>();
          (targetPrs || []).forEach((tpr: AzurePullRequest) => {
            const text = ((tpr.title || '') + ' ' + (tpr.description || '')).toUpperCase();
            const matches = this.getHuMatchesFromText(text);
            if (matches && matches.length) matches.forEach((m: string) => targetHus.add(m));
          });
          (targetCommits || []).forEach((tc: GitCommit) => {
            const text = (tc.comment || '').toUpperCase();
            const matches = this.getHuMatchesFromText(text);
            if (matches && matches.length) matches.forEach((m: string) => targetHus.add(m));
          });

          console.log('HUs encontradas en TARGET (master):', Array.from(targetHus));

          // Diferencia: sourceHus - targetHus
            let finalHus = Array.from(sourceHus).filter(h => !targetHus.has(h));

            // Si estamos en modo strict, por cada HU hacemos una búsqueda por texto para confirmar
            if (this.strictMode && finalHus.length) {
              try {
                const confirmations = await Promise.all(finalHus.map(async (hu) => {
                  try {
                    const prsMatch: AzurePullRequest[] = await firstValueFrom(this.azureService.getPrsBySearchText(this.selectedRepoId, hu).pipe(catchError(() => of([] as AzurePullRequest[]))));
                    // Considerar PRs que ya fueron completados hacia target
                    const foundInTarget = (prsMatch || []).some(p => {
                      const target = (p.targetRefName || '').replace('refs/heads/', '');
                      const status = (p as any).status || (p as any).state || '';
                      const isCompleted = typeof status === 'string' && status.toLowerCase() === 'completed';
                      return (target === targetBranchLocal || isCompleted) && ((p.title || '') + ' ' + (p.description || '')).toUpperCase().includes(hu);
                    });
                    return { hu, foundInTarget };
                  } catch (e) { return { hu, foundInTarget: false }; }
                }));
                // Excluir las HUs confirmadas en target
                finalHus = finalHus.filter(h => !confirmations.find(c => c.hu === h && c.foundInTarget));
              } catch (e) {
                console.warn('Strict verification failed, continuing with non-strict result', e);
              }
            }

          // Mapear a processedHUs con PRs que las contienen (filtrando prs anteriores)
          const huMap = new Map<string, AzurePullRequest[]>();
          finalHus.forEach(h => huMap.set(h, []));
          (prs || []).forEach(pr => {
            const text = ((pr.title || '') + ' ' + (pr.description || '')).toUpperCase();
            const matches = this.getHuMatchesFromText(text) || [];
            matches.forEach((m: string) => {
              const key = m;
              if (huMap.has(key)) {
                huMap.get(key)?.push(pr);
              }
            });
          });

          this.processedHUs = Array.from(huMap.entries()).map(([id, prs]) => ({ id, prs })).sort((a, b) => a.id.localeCompare(b.id));
          console.log('HUs finales pendientes de pasar a target:', this.processedHUs);
          this.cdr.detectChanges();
        } catch (err) {
          console.warn('Error al obtener PRs/commits del target para exclusión:', err);
          this.processedHUs = Array.from(sourceHus).map(id => ({ id, prs: [] }));
          this.cdr.detectChanges();
        }
      });
  }
  private buildExactHuRegex(): RegExp {
    const src = (environment.huRegex && (environment.huRegex as RegExp).source) ? (environment.huRegex as RegExp).source : 'JURP01-[A-Z0-9]+';
    return new RegExp('\\b' + src + '\\b', 'g');
  }

  private getHuMatchesFromText(text: string): string[] {
    if (!text) return [];
    const rx = this.buildExactHuRegex();
    const matches = text.match(rx) || [];
    return matches.map(m => m.trim());
  }
  private analyzePullRequests(prs: AzurePullRequest[]) {
    // Si llegó null o undefined
    if (!prs) prs = [];

    // Filtrar PRs a los más relevantes: preferir PRs completados o aquellos cuyo target sea la rama origen seleccionada.
    prs = prs.filter(pr => {
      if (!pr) return false;
      const target = (pr.targetRefName || '').toLowerCase();
      const sourceLower = (sourceBranchLocal || '').toLowerCase();
      const matchesTarget = target.endsWith('/' + sourceLower) || target === `refs/heads/${sourceLower}` || target.endsWith(sourceLower);
      const status = (pr as any).status || (pr as any).state || '';
      const isCompleted = typeof status === 'string' && status.toLowerCase() === 'completed';
      return matchesTarget || isCompleted;
    });

    const huMap = new Map<string, AzurePullRequest[]>();

    prs.forEach(pr => {
      // 🛡️ Protección contra nulos
      const title = pr.title || '';
      const desc = pr.description || '';
      const fullText = (title + ' ' + desc).toUpperCase();

      console.log('PR:', pr.pullRequestId, 'title:', title);

      const matches = this.getHuMatchesFromText(fullText);

      if (matches && matches.length) {
        const uniqueMatches = [...new Set(matches)];
        uniqueMatches.forEach(hu => {
          const cleanHu = hu;
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

    // Filtrar HUs que YA están integradas en la rama destino (targetBranch)
    if (this.targetBranch) {
      this.azureService.getPullRequestsForTarget(this.selectedRepoId, this.targetBranch).subscribe({
        next: (targetPrs) => {
          this.lastTargetPrs = targetPrs;
          // Construimos un set de HUs que ya aparecen en PRs cuyo target es la rama destino
          const presentInTarget = new Set<string>();
          targetPrs.forEach((tpr: AzurePullRequest) => {
            const text = ((tpr.title || '') + ' ' + (tpr.description || '')).toUpperCase();
            const matches = this.getHuMatchesFromText(text);
            if (matches && matches.length) matches.forEach(m => presentInTarget.add(m));
          });

          // Además, inspeccionar los commits de la rama target para capturar HUs que pudieron llegar sin PRs o con títulos diferentes
          this.azureService.getCommitsForBranch(this.selectedRepoId, this.targetBranch, 500).subscribe({
            next: (commitsInTarget) => {
              (commitsInTarget || []).forEach(c => {
                const text = (c.comment || '').toUpperCase();
                const matches = this.getHuMatchesFromText(text);
                if (matches && matches.length) matches.forEach(m => presentInTarget.add(m));
              });

              // Excluir HUs ya presentes en target (PRs o commits)
              this.processedHUs = this.processedHUs.filter(h => !presentInTarget.has(h.id));
              console.log('HUs después de excluir las ya integradas en', this.targetBranch, ':', this.processedHUs);
              this.cdr.detectChanges();
            },
            error: (err) => {
              console.warn('No se pudo obtener commits de la rama target para filtrar HUs:', err);
              // Si falla obtener commits, al menos excluir según PRs
              this.processedHUs = this.processedHUs.filter(h => !presentInTarget.has(h.id));
              this.cdr.detectChanges();
            }
          });
        },
        error: (err) => {
          console.warn('No se pudo obtener PRs del target para filtrar HUs:', err);
          this.cdr.detectChanges();
        }
      });
    } else {
      // Si no hay targetBranch seleccionado, solo refrescamos
      this.cdr.detectChanges();
    }
  }
}