module.exports = {
  '/jira-api/**': {
    target: 'http://localhost:3001',
    secure: false,
    changeOrigin: true,
    logLevel: 'debug'
  },
  '/Soluciones-Corporativas/**': {
    target: 'http://localhost:3001',
    secure: false,
    changeOrigin: true,
    logLevel: 'debug'
  }
};
