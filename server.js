const { serveHTTP } = require("stremio-addon-sdk");
const addonInterface = require("./addon");

// Usa a porta fornecida pela hospedagem ou a 7000 como segurança local
const PORT = process.env.PORT || 7000;

try {
    serveHTTP(addonInterface, { port: PORT });
    console.log(`Add-on online na porta: ${PORT}`);
} catch (error) {
    console.error("Falha ao iniciar o servidor do add-on:", error.message);
    process.exit(1);
}

// Evita que erros assíncronos não tratados derrubem o processo silenciosamente
process.on("unhandledRejection", (reason) => {
    console.error("Unhandled Rejection:", reason);
});
