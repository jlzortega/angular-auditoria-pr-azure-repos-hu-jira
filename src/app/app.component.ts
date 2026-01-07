import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  standalone: false  // <--- AGREGA ESTA LÍNEA OBLIGATORIAMENTE
})
export class AppComponent {
  title = 'dashboard-azure';
}