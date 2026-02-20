export const environment = {
    production: true,
    azure: {
        organization: 'Soluciones-Corporativas',
        project: 'Juridico',
        apiVersion: '7.1',
        // En producción, use un secreto seguro (no dejar en el repo)
        pat: '<REPLACE_WITH_SECURE_PAT_OR_ENV>'
    },
    huRegex: /JURP01-[A-Z0-9]+/g
};
