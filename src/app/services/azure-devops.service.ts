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
    return `https://dev.azure.com/${org}/${proj}/_apis/git/repositories`;
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
    const body = {
      "$top": 200,
      "itemVersion": { "version": `refs/heads/${sourceBranch}`, "versionType": 0 },
      "compareVersion": { "version": `refs/heads/${targetBranch}`, "versionType": 0 },
      "includeComment": true
    };

    const urlFor = (repoId: string) => `${this.apiUrl}/${encodeURIComponent(repoId)}/commitsBatch?${this.apiVersion}`;

    // First, resolve the repository identifier to get the GUID ID
    return from(this.resolveRepositoryId(repoIdentifier)).pipe(
      switchMap((resolved) => {
        console.log(`📍 Using repository ID for commitsBatch: ${resolved.id} (${resolved.name})`);
        console.log('📤 commitsBatch request URL:', urlFor(resolved.id));
        console.log('📋 commitsBatch request body:', JSON.stringify(body).substring(0, 200) + '...');
        
        return this.http.post<any>(urlFor(resolved.id), body).pipe(
          map(res => {
            console.log('✅ commitsBatch succeeded, received', (res?.value?.length || 0), 'commits');
            return res.value;
          }),
          catchError((err: any) => {
            console.error('❌ commitsBatch failed with ID:', err?.status, err?.statusText);
            // If commitsBatch fails with ID, try with the repository name as fallback
            if (resolved.name !== repoIdentifier) {
              console.log('🔄 Retrying commitsBatch with repository name:', resolved.name);
              return this.http.post<any>(urlFor(resolved.name), body).pipe(
                map(res => {
                  console.log('✅ commitsBatch retry with name succeeded');
                  return res.value;
                }),
                catchError((err2: any) => {
                  console.error('❌ commitsBatch retry with name also failed:', err2?.status);
                  // If both ID and name fail, fallback to local diff calculation
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
                    }),
                    catchError((errFallback: any) => {
                      console.error('❌ Local diff fallback failed:', errFallback?.status);
                      return throwError(() => errFallback);
                    })
                  );
                })
              );
            }
            // If only commitsBatch with ID failed (no name to retry), fallback to local diff
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
              }),
              catchError((errFallback: any) => {
                console.error('❌ Local diff fallback failed:', errFallback?.status);
                return throwError(() => err);
              })
            );
          })
        );
      }),
      catchError((resolveErr: any) => {
        console.error('❌ Failed to resolve repository:', resolveErr?.message);
        return throwError(() => resolveErr);
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
    const url = `${this.apiUrl}/${encodeURIComponent(repoName)}/pullrequestquery?${this.apiVersion}`;

    const body = {
      "queries": [
        {
          "type": 1, // 1 = LastMergeCommit
          "items": commitIds 
        }
      ]
    };

    return this.http.post<any>(url, body).pipe(
      map(response => {
        // 🛡️ BLOQUE DE SEGURIDAD
        // Si la respuesta viene vacía o sin resultados, devolvemos array vacío para no romper
        if (!response || !response.results || response.results.length === 0) {
          console.warn('⚠️ Azure respondió 200 pero sin resultados de PRs.');
          return [];
        }

        let allPrs: AzurePullRequest[] = [];
        
        // El JSON de Azure devuelve un array de objetos. Generalmente es el índice 0.
        // Ejemplo: response.results[0] = { "commitHash1": [PR], "commitHash2": [PR] }
        const resultsBatch = response.results;

        // Iteramos por cada bloque de resultados (por si Azure devuelve más de uno)
        resultsBatch.forEach((resultDictionary: any) => {
          if (!resultDictionary) return;

          // Extraemos todos los valores del diccionario (ignoramos las llaves/hashes)
          // Object.values devuelve: [ [PR1], [PR2], [PR3] ]
          const arraysOfPrs = Object.values(resultDictionary);
          
          arraysOfPrs.forEach((prArray: any) => {
            if (Array.isArray(prArray)) {
              allPrs = [...allPrs, ...prArray];
            }
          });
        });

        // Eliminar duplicados usando un Map por ID de PR
        const uniquePrs = new Map<number, AzurePullRequest>();
        allPrs.forEach(pr => {
          if (pr && pr.pullRequestId) {
            uniquePrs.set(pr.pullRequestId, pr);
          }
        });
        
        const finalResult = Array.from(uniquePrs.values());
        console.log(`✅ Procesamiento finalizado: ${finalResult.length} PRs únicos encontrados.`);
        return finalResult;
      })
    );
  }

  /**
   * Obtener PRs que tienen como target una rama específica y estado 'completed'
   * Usamos este endpoint para saber qué HUs/PRs ya fueron integrados en la rama destino.
   */
  getPullRequestsForTarget(repoName: string, targetBranch: string): Observable<AzurePullRequest[]> {
    // Azure espera refs/heads/{branch} para targetRefName
    const encodedTarget = encodeURIComponent(`refs/heads/${targetBranch}`);
    const url = `${this.apiUrl}/${encodeURIComponent(repoName)}/pullrequests?searchCriteria.status=completed&searchCriteria.targetRefName=${encodedTarget}&${this.apiVersion}`;

    return this.http.get<any>(url).pipe(
      map(res => res || []),
      // En caso de que Azure devuelva objeto con value
      map(res => (res.value && Array.isArray(res.value) ? res.value : res))
    );
  }

  /**
   * Obtener PRs asociados a un commit (endpoint por commit)
   */
  getPrsForCommit(repoName: string, commitId: string): Observable<AzurePullRequest[]> {
    const url = `${this.apiUrl}/${encodeURIComponent(repoName)}/commits/${commitId}/pullRequests?${this.apiVersion}`;
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
  getAllPullRequests(repoName: string): Observable<AzurePullRequest[]> {
    const url = `${this.apiUrl}/${encodeURIComponent(repoName)}/pullrequests?searchCriteria.status=all&${this.apiVersion}`;
    return this.http.get<any>(url).pipe(
      map(res => res || []),
      map(res => (res.value && Array.isArray(res.value) ? res.value : res))
    );
  }
}