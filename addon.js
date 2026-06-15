const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

// URL do BeTor
const URL_ITEMS_BETOR = "https://catalogo.betor.top/static/data/items.json"; 

let torData = [];

async function carregarDadosBeTor() {
    try {
        const response = await axios.get(URL_ITEMS_BETOR);
        torData = response.data || [];
        console.log(`Banco de dados carregado. Itens: ${torData.length}`);
    } catch (error) {
        console.error("Erro no carregamento:", error.message);
    }
}
carregarDadosBeTor();

const manifest = {
    id: "community.betorbr.online",
    version: "1.0.8",
    name: "BeTor v3 Oficial",
    description: "Busca de torrents brasileiros do BeTor",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id }) => {
    const partesId = id.split(":");
    const imdbId = partesId[0]; 

    // Filtra pelo ID do IMDb
    let resultados = torData.filter(item => item.imdb_id === imdbId);

    // Se for série, fazemos uma filtragem "leve" (não destrutiva)
    if (type === "series" && partesId[1] && partesId[2]) {
        const sAlvo = parseInt(partesId[1], 10); 
        const eAlvo = parseInt(partesId[2], 10); 

        resultados = resultados.filter(item => {
            const nome = (item.torrent_name || "").toLowerCase();
            
            // Regex para buscar S01E01 ou 1x01
            const matchEp = nome.match(/(?:s|season\s*)(\d+)\s*(?:e|x|ep\s*)(\d+)/i);
            // Regex para buscar S01 ou Temporada 1
            const matchTemp = nome.match(/(?:s|season\s*|temporada\s*)(\d+)/i);

            // SE o título tiver uma marcação de temporada, verificamos se ela está correta
            if (matchTemp) {
                const tempEncontrada = parseInt(matchTemp[1], 10);
                if (tempEncontrada !== sAlvo) return false; // Se for temporada diferente, remove
            }

            // SE o título tiver uma marcação de episódio, verificamos se ela está correta
            if (matchEp) {
                const tempEncontrada = parseInt(matchEp[1], 10);
                const epEncontrado = parseInt(matchEp[2], 10);
                if (tempEncontrada !== sAlvo || epEncontrado !== eAlvo) return false; // Se ep errado, remove
            }

            // Se chegou aqui, o item é válido (ou não tinha marcações específicas para filtrar)
            return true;
        });
    }

    if (resultados.length === 0) return { streams: [] };

    // Formata
    const streams = resultados.map(torrent => {
        const hash = (torrent.magnet_xt || "").split(":").pop() || (torrent.magnet_uri || "").match(/btih:([a-zA-Z0-9]+)/)?.[1];
        if (!hash || hash.length < 40) return null;

        return {
            name: `BeTor\n[${torrent.provider_slug || "BeTor"}]`,
            title: `${torrent.torrent_name}\n👤 ${torrent.torrent_num_seeds || 0} Seeds`,
            infoHash: hash.toLowerCase()
        };
    }).filter(s => s !== null);

    return { streams };
});

module.exports = builder.getInterface();
