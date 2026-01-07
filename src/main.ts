import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app/app.module';

platformBrowserDynamic().bootstrapModule(AppModule)
  // CAMBIO AQUÍ: Agrega el tipo ': any' al error
  .catch((err: any) => console.error(err));