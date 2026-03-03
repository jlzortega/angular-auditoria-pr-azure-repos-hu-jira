import { Injectable } from '@angular/core';

export interface AppConfig {
    azurePat: string;
    azureOrg: string;
    azureProject: string;
    azureApiVersion: string;
    jiraUrl: string;
    jiraEmail: string;
    jiraToken: string;
}

@Injectable({
    providedIn: 'root'
})
export class ConfigService {
    private config: AppConfig | null = null;

    constructor() {
        this.loadFromSession();
    }

    saveConfig(config: AppConfig) {
        this.config = config;
        try {
            sessionStorage.setItem('app_config', JSON.stringify(config));
        } catch (e) {
            console.error('Error saving config to session:', e);
        }
    }

    getConfig(): AppConfig | null {
        if (!this.config) {
            this.loadFromSession();
        }
        return this.config;
    }

    private loadFromSession() {
        try {
            const saved = sessionStorage.getItem('app_config');
            if (saved) {
                this.config = JSON.parse(saved);
            }
        } catch (e) {
            console.error('Error loading config from session:', e);
        }
    }

    isConfigured(): boolean {
        const cfg = this.getConfig();
        return !!(cfg && cfg.azurePat && cfg.jiraUrl);
    }

    clearConfig() {
        this.config = null;
        sessionStorage.removeItem('app_config');
    }
}
