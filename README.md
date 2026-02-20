# angular-auditoria-pr-azure-repos-hu-jira
Repositorio del spa para auditar el pullrequest entre ramas de azure repos para ubicar especificamente en los titulos y descripciones una nomenclatura JURP01-XXXX para detectar la trazabilidad de las HU que tenemos registradas en JIRA


export const environment = {
    production: false,
    azure: {
        organization: 'Soluciones-Corporativas',
        project: 'Juridico',
        apiVersion: '7.1',
        // Personal Access Token (no subir el token real al repo)
        pat: ''
    },
    // Regex para detectar HUs de JIRA en título/descr (devuelve todas las coincidencias)
    // Formato esperado: JURP01-XXXXXX (letras/dígitos después del guion)
    huRegex: /JURP01-[A-Z0-9]+/g
};