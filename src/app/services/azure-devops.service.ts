import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { GitRepository, GitCommit, AzurePullRequest } from '../models/azure.models';

@Injectable({
  providedIn: 'root'
})
export class AzureDevopsService {
  private apiUrl = `https://dev.azure.com/${environment.azure.organization}/${environment.azure.project}/_apis/git/repositories`;
  private apiVersion = `api-version=${environment.azure.apiVersion}`;

  constructor(private http: HttpClient) { }

  getRepositories(): Observable<GitRepository[]> {
    return this.http.get<any>(`${this.apiUrl}?${this.apiVersion}`).pipe(
      map(res => res.value)
    );
  }

  getBranches(repoName: string): Observable<string[]> {
    const url = `${this.apiUrl}/${encodeURIComponent(repoName)}/refs?filter=heads/&${this.apiVersion}`;
    return this.http.get<any>(url).pipe(
      map(res => res.value.map((ref: any) => ref.name.replace('refs/heads/', '')))
    );
  }

  /**
   * Obtiene los commits que existen en sourceBranch pero NO en targetBranch.
   * itemVersion = Rama con los cambios nuevos (Origen)
   * compareVersion = Rama base (Destino)
   */
  getCommitsDiff(repoName: string, sourceBranch: string, targetBranch: string): Observable<GitCommit[]> {
    const url = `${this.apiUrl}/${encodeURIComponent(repoName)}/commitsBatch?${this.apiVersion}`;

    const body = {
      "$top": 200, // Aumentamos un poco el límite
      "itemVersion": { "version": targetBranch, "versionType": 0 },     // Lo que tengo nuevo
      "compareVersion": { "version": sourceBranch, "versionType": 0 },  // Contra lo que comparo
      "includeComment": true // Pedimos el comentario explícitamente para ahorrar llamadas extra si la API lo permite
    };

    return this.http.post<any>(url, body).pipe(
      map(res => res.value)
    );
  }

  // Nota: commitsBatch suele devolver el comentario, pero si viene truncado,
  // mantengo este método por si necesitamos el detalle completo.
  getCommitDetail(repoName: string, commitId: string): Observable<GitCommit> {
    const url = `${this.apiUrl}/${encodeURIComponent(repoName)}/commits/${commitId}?${this.apiVersion}`;
    return this.http.get<GitCommit>(url);
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
}