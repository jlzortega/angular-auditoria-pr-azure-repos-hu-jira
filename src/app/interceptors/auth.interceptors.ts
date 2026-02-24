import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // Interceptamos peticiones a Azure tanto en producción (dev.azure.com)
    // como en desarrollo cuando usamos la ruta relativa que pasa por el proxy.
    const org = environment.azure.organization;
    const isProxyRequest = request.url.startsWith(`/${org}`);
    const isDirectRequest = request.url.includes('dev.azure.com');

    if (isProxyRequest || isDirectRequest) {
      const pat = environment.azure.pat;
      const authString = `:${pat || ''}`;
      const authBase64 = btoa(authString);

      console.log(`AuthInterceptor: Adding Auth to ${isProxyRequest ? 'PROXY' : 'DIRECT'} request: ${request.url}`);

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