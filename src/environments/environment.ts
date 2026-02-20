export const environment = {
    production: false,
    azure: {
        organization: 'Soluciones-Corporativas',
        project: 'Juridico',
        apiVersion: '7.1',
        // Personal Access Token (no subir el token real al repo)
        pat: 'FgvxSXCax011XvCMT1TzrrS0ASGo4wRTLWD9ucF9R6jPxXpGh383JQQJ99CBACAAAAAS5VUfAAASAZDO2FOi'
    },
    // Regex para detectar HUs de JIRA en título/descr (devuelve todas las coincidencias)
    // Formato esperado: JURP01-XXXXXX (letras/dígitos después del guion)
    huRegex: /JURP01-[A-Z0-9]+/g
};