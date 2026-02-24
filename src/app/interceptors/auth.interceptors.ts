import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // Interceptamos peticiones a Azure tanto en producción (dev.azure.com)
    // como en desarrollo cuando usamos la ruta relativa que pasa por el proxy.
    const isLocalDevRequest = ((): boolean => {
      try {
        // Coerce to boolean to satisfy TypeScript (avoid mixed string|boolean from && chain)
        return !!(typeof window !== 'undefined' &&
          window.location &&
          window.location.hostname &&
          window.location.hostname.includes('localhost') &&
          request.url &&
          (request.url as unknown as string).startsWith('/'));
      } catch (e) { return false; }
    })();

    const shouldAddAuth = request.url.includes('dev.azure.com') || isLocalDevRequest;
    if (shouldAddAuth) {
      const pat = environment.azure.pat;
      const hasPat = !!pat;
      try {
        console.log('AuthInterceptor: dev.azure request detected. PAT present:', hasPat, 'PAT length:', pat ? pat.length : 0);
      } catch (e) { /* ignore logging failures */ }

      const authString = ':' + (pat || '');
      const authBase64 = btoa(authString);

      const authReq = request.clone({
        setHeaders: {
          'Authorization': `Basic ${authBase64}`,
          // DO NOT send x-dev-pat to Azure — only for local proxy mapping
          'Content-Type': 'application/json'
        }
      });

      // Safe log to confirm header has been attached (do not print token)
      try { console.log('AuthInterceptor: cloned request with Authorization header length:', (`Basic ${authBase64}`).length); } catch (e) {}

      return next.handle(authReq);
    }
    return next.handle(request);
  }
}