import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

// 👇 1. IMPORTAR la nueva forma de proveer HTTP
import { provideHttpClient, withInterceptorsFromDi, HTTP_INTERCEPTORS } from '@angular/common/http';

import { AppComponent } from './app.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { AuthInterceptor } from './interceptors/auth.interceptors';

@NgModule({
  declarations: [
    AppComponent
  ],
  imports: [
    BrowserModule,
    FormsModule,
    BrowserAnimationsModule,
    DashboardComponent 
  ],
  providers: [
    // 👇 2. CONFIGURACIÓN MODERNA DEL CLIENTE HTTP
    // Esto habilita el HttpClient y permite que lea los interceptores "clásicos" (DI)
    provideHttpClient(withInterceptorsFromDi()), 

    // 👇 3. REGISTRO DE TU INTERCEPTOR
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }