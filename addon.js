const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

// Coloque aqui a URL direta do items.json que você achou no site do BeTor
// Exemplo: "https://betor.pub/data/items.json" ou a URL correta do domínio deles
const URL_ITEMS_BETOR = "https://catalogo.betor.top/static/data/items.json"; 

let torData = [];

// Função que baixa os dados do BeTor para a memória ao iniciar
async function carregarDadosBeTor() {
    try {
        console.log("Baixando banco de dados atualizado do BeTor...");
        const response = await axios.get(URL_ITEMS_BETOR);
        torData = response.data || [];
        console.log(`Banco de dados carregado com sucesso! Itens: ${torData.length}`);
    } catch (error) {
        console.error("Erro crítico ao baixar dados do BeTor:", error.message);
    }
}

// Inicializa a carga de dados imediatamente ao rodar o script
carregarDadosBeTor();

const manifest = {
    id: "community.betorbr.online",
    version: "1.0.0",
    name: "BeTor v3 Oficial",
    description: "Busca torrents brasileiros direto do catálogo atualizado do BeTor",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id }) => {
    const imdbId = id.split(":")[0]; 
    console.log(`[Stremio Cloud] Buscando fontes para: ${imdbId}`);

    const resultados = torData.filter(item => item.imdb_id === imdbId);

    if (resultados.length === 0) return { streams: [] };

    const streams = resultados.map(torrent => {
        const titulo = torrent.torrent_name || "Torrent Brasileiro";
        const seeds = torrent.torrent_num_seeds || 0;
        const peers = torrent.torrent_num_peers || 0;
        const provedor = torrent.provider_slug || "BeTor";

        let hash = "";
        if (torrent.magnet_xt) {
            hash = torrent.magnet_xt.split(":").pop();
        } else if (torrent.magnet_uri) {
            const match = torrent.magnet_uri.match(/btih:([a-zA-Z0-9]+)/);
            if (match) hash = match[1];
        }

        if (hash) hash = hash.trim().toLowerCase();

        return {
            name: `BeTor\n[${provedor}]`,
            title: `${titulo}\n👤 Seeds: ${seeds} | 👥 Peers: ${peers}`,
            infoHash: hash
        };
    });

    const streamsValidos = streams.filter(s => s.infoHash && s.infoHash.length === 40);
    return { streams: streamsValidos };
});

module.exports = builder.getInterface();
