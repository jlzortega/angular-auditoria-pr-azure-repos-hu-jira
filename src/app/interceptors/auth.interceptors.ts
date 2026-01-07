import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // Solo interceptamos peticiones que vayan a dev.azure.com
    if (request.url.includes('dev.azure.com')) {
      const authString = ':' + environment.azure.pat;
      const authBase64 = btoa(authString);

      const authReq = request.clone({
        setHeaders: {
          'Authorization': `Basic ${authBase64}`,
          'Content-Type': 'application/json'
        }
      });
      return next.handle(authReq);
    }
    return next.handle(request);
  }
}