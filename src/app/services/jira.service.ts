import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, catchError, map } from 'rxjs';
import { ConfigService } from './config.service';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class JiraService {
    constructor(
        private http: HttpClient,
        private configService: ConfigService
    ) { }

    getIssueType(issueId: string): Observable<string> {
        const config = this.configService.getConfig();
        if (!config || !config.jiraUrl || !config.jiraToken) {
            console.warn(`[JiraService] Jira NO configurado para ${issueId}.`);
            return of('User Story');
        }

        const cleanId = issueId.trim().toUpperCase();
        const hostMatch = config.jiraUrl.match(/^(?:https?:\/\/)?([^\/]+)/i);
        const host = hostMatch ? hostMatch[1] : config.jiraUrl;


        // URL limpia de proxy (SIN PUNTOS en el primer segmento para no confundir a Vite)
        const url = `/jira-api/rest/api/3/issue/${cleanId}?fields=issuetype`;

        console.log(`%c[JiraService DEBUG] Calling: ${url} (Host: ${host})`, 'color: blue; font-weight: bold');

        return this.http.get<any>(url, {
            headers: { 'X-Jira-Host': host }
        }).pipe(
            map(res => {
                const typeName = res?.fields?.issuetype?.name || 'Unknown';
                console.log(`%c[JiraService DEBUG] ${cleanId} is ${typeName}`, 'color: green');
                return typeName;
            }),
            catchError(err => {
                console.error(`%c[JiraService DEBUG] FAILED for ${issueId}`, 'color: red', err);
                if (err.status === 200) {
                    console.log(`%c[JiraService DEBUG] 200 OK but failed parsing. Body:`, 'color: orange', err.error?.text || err.error);
                }
                return of('Error');
            })
        );
    }
}
