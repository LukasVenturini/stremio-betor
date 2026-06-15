const { serveHTTP } = require("stremio-addon-sdk");
const addonInterface = require("./addon");

// Usa a porta fornecida pela hospedagem ou a 7000 como segurança local
const PORT = process.env.PORT || 7000;

serveHTTP(addonInterface, { port: PORT });

console.log(`Add-on online na porta: ${PORT}`);