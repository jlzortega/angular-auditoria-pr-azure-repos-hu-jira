import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable, forkJoin, of, catchError, switchMap, throwError, from } from 'rxjs';
import { environment } from '../../environments/environment';
import { GitRepository, GitCommit, AzurePullRequest } from '../models/azure.models';

@Injectable({
  providedIn: 'root'
})
export class AzureDevopsService {
  // Always use full Azure DevOps URL; the interceptor handles Authorization
  private apiUrl: string = (() => {
    const org = environment.azure.organization;
    const proj = environment.azure.project;
    return `/${org}/${proj}/_apis/git/repositories`;
  })();
  private apiVersion = `api-version=${environment.azure.apiVersion}`;

  constructor(private http: HttpClient) { }

  getRepositories(): Observable<GitRepository[]> {
    return this.http.get<any>(`${this.apiUrl}?${this.apiVersion}`).pipe(
      map(res => {
        const repos = res.value || [];
        console.log('📦 Loaded repositories from Azure:', repos.map((r: any) => ({ id: r.id, name: r.name })));
        return repos;
      })
    );
  }

  /**
   * Resolve a repository identifier (name or ID) to a repository object with both id and name.
   * This ensures we always have the GUID ID for API calls that require it.
   */
  async resolveRepositoryId(identifier: string): Promise<{ id: string; name: string }> {
    try {
      if (!identifier) throw new Error('Empty repository identifier');

      const repos = await this.http.get<any>(`${this.apiUrl}?${this.apiVersion}`).toPromise() as any;
      const repoList = repos?.value || [];

      // First try to match by ID (GUID)
      const byId = repoList.find((r: any) => r.id === identifier);
      if (byId) {
        console.log('✅ Resolved repository by ID:', identifier, '→', byId.name);
        return { id: byId.id, name: byId.name };
      }

      // Then try to match by name
      const byName = repoList.find((r: any) => r.name === identifier || r.name?.toLowerCase() === identifier?.toLowerCase());
      if (byName) {
        console.log('✅ Resolved repository by name:', identifier, '→', byName.id);
        return { id: byName.id, name: byName.name };
      }

      console.error('❌ Repository not found:', identifier);
      throw new Error(`Repository "${identifier}" not found in project`);
    } catch (err) {
      console.error('❌ Error resolving repository:', err);
      throw err;
    }
  }

  /**
   * Obtener todos los pull requests paginados (usa continuationToken)
   * Devuelve una Promise con todos los PRs del repositorio.
   */
  async getAllPullRequestsPaginated(repoName: string): Promise<AzurePullRequest[]> {
    const all: AzurePullRequest[] = [];
    let continuation: string | undefined = undefined;
    const encodedRepo = encodeURIComponent(repoName);
    do {
      const url = `${this.apiUrl}/${encodedRepo}/pullrequests?searchCriteria.status=all&${this.apiVersion}` + (continuation ? `&continuationToken=${encodeURIComponent(continuation)}` : '');
      try {
        // Usamos firstValueFrom style con await
        // Note: HttpClient.get devuelve observable; to convert use toPromise via lastValueFrom but avoid import; use await on toPromise not available — use subscribe promisified
        // Simpler: call toPromise via .toPromise() is deprecated; instead use firstValueFrom when calling from component. Here we use synchronous await via promise wrapper.
        const res: any = await this.http.get<any>(url).toPromise();
        const items = (res && res.value && Array.isArray(res.value)) ? res.value : (res || []);
        all.push(...items);
        // Azure may return continuationToken in headers or body; check body
        continuation = res && res.continuationToken ? res.continuationToken : undefined;
      } catch (e) {
        // stop on error
        break;
      }
    } while (continuation);
    return all;
  }

  /**
   * Obtener commits de una rama paginados usando $top y $skip
   */
  async getAllCommitsForBranchPaginated(repoName: string, branch: string, pageSize: number = 200): Promise<GitCommit[]> {
    const all: GitCommit[] = [];
    let skip = 0;
    const encodedBranch = encodeURIComponent(branch);
    const encodedRepo = encodeURIComponent(repoName);
    while (true) {
      const url = `${this.apiUrl}/${encodedRepo}/commits?searchCriteria.itemVersion.version=${encodedBranch}&$top=${pageSize}&$skip=${skip}&${this.apiVersion}`;
      try {
        const res: any = await this.http.get<any>(url).toPromise();
        const items = (res && res.value && Array.isArray(res.value)) ? res.value : (res || []);
        if (!items || items.length === 0) break;
        all.push(...items);
        if (items.length < pageSize) break;
        skip += pageSize;
      } catch (e) {
        break;
      }
    }
    return all;
  }

  async getBranches(repoIdentifier: string): Promise<string[]> {
    try {
      // Resolve the repository identifier to get the GUID ID
      const resolved = await this.resolveRepositoryId(repoIdentifier);
      const url = `${this.apiUrl}/${encodeURIComponent(resolved.id)}/refs?filter=heads/&${this.apiVersion}`;
      console.log(`🌿 Fetching branches for repo ${resolved.name} using ID: ${resolved.id}`);

      const res: any = await this.http.get<any>(url).toPromise();
      const branches = (res?.value || []).map((ref: any) => ref.name.replace('refs/heads/', ''));
      console.log(`✅ Loaded ${branches.length} branches`);
      return branches;
    } catch (err: any) {
      console.error('❌ Error fetching branches:', err?.message);
      throw err;
    }
  }

  /**
   * Obtiene los commits que existen en sourceBranch pero NO en targetBranch.
   * itemVersion = Rama con los cambios nuevos (Origen)
   * compareVersion = Rama base (Destino)
   * 
   * Primero resuelve el identifier (nombre o GUID) a un repo object con el ID,
   * luego usa el ID GUID para el commitsBatch endpoint.
   */
  getCommitsDiff(repoIdentifier: string, sourceBranch: string, targetBranch: string): Observable<GitCommit[]> {
    // The most efficient way to get branch differences in Azure DevOps is the "diffs/commits" endpoint.
    // It's a GET request that returns exactly what's in 'targetVersion' (source) but not in 'baseVersion' (target).

    return from(this.resolveRepositoryId(repoIdentifier)).pipe(
      switchMap((resolved) => {
        const org = environment.azure.organization;
        const proj = environment.azure.project;

        // Construct the URL using the project and repository ID
        const url = `/${org}/${proj}/_apis/git/repositories/${resolved.id}/diffs/commits` +
          `?baseVersion=${encodeURIComponent(targetBranch)}&baseVersionType=branch` +
          `&targetVersion=${encodeURIComponent(sourceBranch)}&targetVersionType=branch` +
          `&api-version=7.1`;

        console.log(`🔍 Comparing branches using diffs API: ${targetBranch} vs ${sourceBranch}`);
        console.log(`📤 Diff request URL: ${url}`);

        return this.http.get<any>(url).pipe(
          map(res => {
            const commits = res?.commits || [];
            console.log(`✅ Diff API succeeded, found ${commits.length} commits`);
            return commits.filter((c: any) => c && c.commitId);
          }),
          catchError((err: any) => {
            console.error('❌ Diff API failed:', err?.status, err?.statusText);
            // Final fallback to local diff if even the specialized API fails
            console.log('🔄 Falling back to local diff calculation...');
            return forkJoin([
              this.getCommitsForBranch(resolved.id, sourceBranch, 1000).pipe(catchError(() => of([] as GitCommit[]))),
              this.getCommitsForBranch(resolved.id, targetBranch, 1000).pipe(catchError(() => of([] as GitCommit[])))
            ]).pipe(
              map(([srcCommits, tgtCommits]) => {
                const targetSet = new Set((tgtCommits || []).map((c: any) => c.commitId));
                const diff = (srcCommits || []).filter((c: any) => !targetSet.has(c.commitId));
                console.log(`✅ Local diff fallback produced ${diff.length} commits`);
                return diff;
              })
            );
          })
        );
      })
    );
  }

  // Nota: commitsBatch suele devolver el comentario, pero si viene truncado,
  // mantengo este método por si necesitamos el detalle completo.
  getCommitDetail(repoName: string, commitId: string): Observable<GitCommit> {
    const url = `${this.apiUrl}/${encodeURIComponent(repoName)}/commits/${commitId}?${this.apiVersion}`;
    return this.http.get<GitCommit>(url);
  }

  /**
   * Obtener commits de una rama (por ejemplo para inspeccionar mensajes en target branch)
   * Devuelve hasta `top` commits (por defecto 200)
   */
  getCommitsForBranch(repoName: string, branch: string, top: number = 200): Observable<GitCommit[]> {
    const encodedBranch = encodeURIComponent(branch);
    const url = `${this.apiUrl}/${encodeURIComponent(repoName)}/commits?searchCriteria.itemVersion.version=${encodedBranch}&$top=${top}&${this.apiVersion}`;
    return this.http.get<any>(url).pipe(
      map(res => res || []),
      map(res => (res.value && Array.isArray(res.value) ? res.value : res))
    );
  }

  /**
   * 5. Obtener PRs asociados a una lista de Commits
   * Endpoint: /_apis/git/repositories/{repoId}/pullrequestquery
   */
  getPrsByCommitIds(repoName: string, commitIds: string[]): Observable<AzurePullRequest[]> {
    if (!commitIds || commitIds.length === 0) return of([]);

    const org = environment.azure.organization;
    const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repoName);
    const baseApi = isGuid ? `/${org}/_apis/git/repositories` : this.apiUrl;
    const url = `${baseApi}/${encodeURIComponent(repoName)}/pullRequestQuery?${this.apiVersion}`;

    // Chunk commits to avoid Azure API limits or timeouts (batch of 25 is safe)
    const chunkSize = 25;
    const chunks: string[][] = [];
    for (let i = 0; i < commitIds.length; i += chunkSize) {
      chunks.push(commitIds.slice(i, i + chunkSize));
    }

    console.log(`🔍 Consultando PRs en ${chunks.length} lotes para ${commitIds.length} commits...`);

    const requests = chunks.map(batch => {
      const body = {
        "queries": [
          {
            "type": 2, // 2 = Commit
            "items": batch
          }
        ]
      };
      return this.http.post<any>(url, body).pipe(
        map(response => {
          if (!response || !response.results || response.results.length === 0) return [];

          let batchPrs: AzurePullRequest[] = [];
          response.results.forEach((dict: any) => {
            if (!dict) return;
            Object.values(dict).forEach((arr: any) => {
              if (Array.isArray(arr)) batchPrs.push(...arr);
            });
          });
          return batchPrs;
        }),
        catchError(err => {
          console.warn('⚠️ Error en lote de PRs:', err);
          return of([]);
        })
      );
    });

    return forkJoin(requests).pipe(
      map(results => {
        const allPrs = results.flat();
        const uniquePrs = new Map<number, AzurePullRequest>();
        allPrs.forEach(pr => {
          if (pr && pr.pullRequestId) uniquePrs.set(pr.pullRequestId, pr);
        });
        const finalContent = Array.from(uniquePrs.values());
        console.log(`✅ Consulta de PRs completada. Total: ${finalContent.length} PRs únicos.`);
        return finalContent;
      })
    );
  }

  /**
   * Obtener PRs que tienen como target una rama específica y estado 'completed'
   * Usamos este endpoint para saber qué HUs/PRs ya fueron integrados en la rama destino.
   */
  getPullRequestsForTarget(repoName: string, targetBranch: string, top: number = 1000): Observable<AzurePullRequest[]> {
    // Azure espera refs/heads/{branch} para targetRefName
    const encodedTarget = encodeURIComponent(`refs/heads/${targetBranch}`);
    const url = `${this.apiUrl}/${encodeURIComponent(repoName)}/pullrequests?searchCriteria.status=completed&searchCriteria.targetRefName=${encodedTarget}&$top=${top}&${this.apiVersion}`;

    return this.http.get<any>(url).pipe(
      map(res => res || []),
      map(res => (res.value && Array.isArray(res.value) ? res.value : res))
    );
  }

  /**
   * Obtener PRs asociados a un commit (endpoint por commit)
   */
  getPrsForCommit(repoName: string, commitId: string): Observable<AzurePullRequest[]> {
    const url = `${this.apiUrl}/${encodeURIComponent(repoName)}/commits/${commitId}/pullrequests?${this.apiVersion}`;
    return this.http.get<any>(url).pipe(
      map(res => res || []),
      map(res => (res.value && Array.isArray(res.value) ? res.value : res))
    );
  }

  /**
   * Fallback: Obtener PRs para una lista de commits llamando al endpoint por commit
   */
  getPrsForCommitIdsFallback(repoName: string, commitIds: string[]): Observable<AzurePullRequest[]> {
    if (!commitIds || commitIds.length === 0) return new Observable<AzurePullRequest[]>(sub => { sub.next([]); sub.complete(); });

    const calls = commitIds.map(id => this.getPrsForCommit(repoName, id));
    return forkJoin(calls).pipe(
      map((arrays: AzurePullRequest[][]) => {
        const all = ([] as AzurePullRequest[]).concat(...arrays);
        const unique = new Map<number, AzurePullRequest>();
        all.forEach(pr => { if (pr && pr.pullRequestId) unique.set(pr.pullRequestId, pr); });
        return Array.from(unique.values());
      })
    );
  }

  /**
   * Buscar PRs por rama origen (source branch). Devuelve PRs cuyo sourceRefName coincide.
   */
  getPrsBySourceBranch(repoName: string, sourceBranch: string): Observable<AzurePullRequest[]> {
    const encodedSource = encodeURIComponent(`refs/heads/${sourceBranch}`);
    const url = `${this.apiUrl}/${encodeURIComponent(repoName)}/pullrequests?searchCriteria.sourceRefName=${encodedSource}&${this.apiVersion}`;
    return this.http.get<any>(url).pipe(
      map(res => res || []),
      map(res => (res.value && Array.isArray(res.value) ? res.value : res))
    );
  }

  /**
   * Obtener PRs por texto de búsqueda (searchText)
   */
  getPrsBySearchText(repoName: string, searchText: string): Observable<AzurePullRequest[]> {
    const encodedText = encodeURIComponent(searchText);
    const url = `${this.apiUrl}/${encodeURIComponent(repoName)}/pullrequests?searchCriteria.searchText=${encodedText}&searchCriteria.status=all&${this.apiVersion}`;
    return this.http.get<any>(url).pipe(
      map(res => res || []),
      map(res => (res.value && Array.isArray(res.value) ? res.value : res))
    );
  }

  /**
   * Obtener todos los PRs del repositorio (estado = all). Útil como último recurso diagnósticoy de búsqueda.
   */
  getAllPullRequests(repoName: string, top: number = 200): Observable<AzurePullRequest[]> {
    const url = `${this.apiUrl}/${encodeURIComponent(repoName)}/pullrequests?searchCriteria.status=all&$top=${top}&${this.apiVersion}`;
    return this.http.get<any>(url).pipe(
      map(res => res || []),
      map(res => (res.value && Array.isArray(res.value) ? res.value : res))
    );
  }
}