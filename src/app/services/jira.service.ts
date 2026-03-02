import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, catchError, map } from 'rxjs';
import { ConfigService } from './config.service';
import { environment } from '../../environments/environment';

export interface JiraIssueDetails {
    type: string;
    status: string;
    internalId: string;
}

export interface JiraDevStatus {
    pullRequests: any[];
    branches: any[];
}

@Injectable({
    providedIn: 'root'
})
export class JiraService {
    constructor(
        private http: HttpClient,
        private configService: ConfigService
    ) { }

    getIssueDetails(issueId: string): Observable<JiraIssueDetails> {
        const config = this.configService.getConfig();
        if (!config || !config.jiraUrl || !config.jiraToken) {
            console.warn(`[JiraService] Jira NO configurado para ${issueId}.`);
            return of({ type: 'User Story', status: 'Unknown', internalId: '' });
        }

        const cleanId = issueId.trim().toUpperCase();
        const hostMatch = config.jiraUrl.match(/^(?:https?:\/\/)?([^\/]+)/i);
        const host = hostMatch ? hostMatch[1] : config.jiraUrl;

        // URL limpia de proxy solicitando status e issuetype
        const url = `/jira-api/rest/api/3/issue/${cleanId}?fields=issuetype,status`;

        console.log(`%c[JiraService DEBUG] Calling: ${url} (Host: ${host})`, 'color: blue; font-weight: bold');

        return this.http.get<any>(url, {
            headers: { 'X-Jira-Host': host }
        }).pipe(
            map(res => {
                const typeName = res?.fields?.issuetype?.name || 'Unknown';
                const statusName = res?.fields?.status?.name || 'Unknown';
                const internalId = res?.id || '';
                console.log(`%c[JiraService DEBUG] ${cleanId} is ${typeName}, Status: ${statusName}`, 'color: green');
                return { type: typeName, status: statusName, internalId };
            }),
            catchError(err => {
                console.error(`%c[JiraService DEBUG] FAILED for ${issueId}`, 'color: red', err);
                return of({ type: 'Error', status: 'Error', internalId: '' });
            })
        );
    }

    getIssueDevStatus(internalId: string): Observable<JiraDevStatus> {
        const config = this.configService.getConfig();
        if (!config || !config.jiraUrl || !config.jiraToken || !internalId) {
            return of({ pullRequests: [], branches: [] });
        }

        const hostMatch = config.jiraUrl.match(/^(?:https?:\/\/)?([^\/]+)/i);
        const host = hostMatch ? hostMatch[1] : config.jiraUrl;

        // Consultamos el summary del development panel. (En Jira Cloud esto es usualmente accesible).
        const url = `/jira-api/rest/dev-status/latest/issue/summary?issueId=${internalId}`;

        console.log(`%c[JiraService DEBUG] Calling Dev-Status: ${url}`, 'color: purple');

        return this.http.get<any>(url, {
            headers: { 'X-Jira-Host': host }
        }).pipe(
            map(res => {
                const summary = res?.summary || {};
                const pullrequests = summary?.pullrequest?.overall?.details || [];
                const branches = summary?.branch?.overall?.details || [];
                return { pullRequests: pullrequests, branches: branches };
            }),
            catchError(err => {
                console.error(`%c[JiraService DEBUG] Dev-Status FAILED for ID ${internalId}`, 'color: red', err);
                return of({ pullRequests: [], branches: [] });
            })
        );
    }
}
