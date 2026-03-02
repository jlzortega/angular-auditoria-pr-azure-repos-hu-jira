import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ConfigService } from '../services/config.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private configService: ConfigService) { }

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    console.log(`%c[AuthInterceptor] Requesting: ${request.url}`, 'color: orange');
    const config = this.configService.getConfig();

    // 1. Azure DevOps
    const org = environment.azure.organization;
    const isAzureRequest = request.url.startsWith(`/${org}`) || request.url.includes('dev.azure.com');

    if (isAzureRequest) {
      const pat = config?.azurePat || environment.azure.pat;
      if (pat) {
        const authString = `:${pat}`;
        const authBase64 = btoa(authString);
        console.log(`[AuthInterceptor] Adding Azure Auth to: ${request.url}`);
        const authReq = request.clone({
          setHeaders: {
            'Authorization': `Basic ${authBase64}`,
            'Content-Type': 'application/json'
          }
        });
        return next.handle(authReq);
      }
    }


    // 2. Jira (Proxy)
    if (request.url.includes('/jira-api')) {
      const email = config?.jiraEmail || (environment as any).jira?.email || '';
      const token = config?.jiraToken || (environment as any).jira?.token || '';

      const authString = `${email}:${token}`;
      const authBase64 = btoa(authString);

      console.log(`%c[AuthInterceptor] Adding Jira Auth to /jira-api call. Creds: ${email ? 'YES' : 'NO'}`, 'color: #00bcd4');

      const authReq = request.clone({
        setHeaders: {
          'Authorization': `Basic ${authBase64}`,
          'Accept': 'application/json'
        }
      });
      return next.handle(authReq);
    }

    return next.handle(request);
  }
}