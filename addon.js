const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

// Coloque aqui a URL direta do items.json do BeTor
const URL_ITEMS_BETOR = "https://catalogo.betor.top/static/data/items.json"; 

let torData = [];

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

carregarDadosBeTor();

const manifest = {
    id: "community.betorbr.online",
    version: "1.0.3",
    name: "BeTor v3 Oficial",
    description: "Busca torrents brasileiros direto do catálogo atualizado do BeTor",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id }) => {
    const partesId = id.split(":");
    const imdbId = partesId[0]; 
    const temporada = partesId[1]; // String (Ex: "1")
    const episodio = partesId[2];  // String (Ex: "1")

    console.log(`[Stremio Cloud] Buscando fontes para ID: ${imdbId} | Tipo: ${type}`);

    // 1. Filtra pelo ID principal no IMDb
    let resultados = torData.filter(item => item.imdb_id === imdbId);

    // 2. Se for série, aplica a filtragem inteligente de episódios
    if (type === "series" && temporada && episodio) {
        const tempOriginal = parseInt(temporada, 10);
        const epOriginal = parseInt(episodio, 10);
        
        const padraoSxxExx = `s${temporada.padStart(2, '0')}e${episodio.padStart(2, '0')}`; // s01e01
        const padraoX = `${temporada}x${episodio.padStart(2, '0')}`; // 1x01

        resultados = resultados.filter(item => {
            const nomeMinusculo = (item.torrent_name || "").toLowerCase();

            // Se o título contiver exatamente o código do episódio (ex: S01E01 ou 1x01), RECONHECE NA HORA
            if (nomeMinusculo.includes(padraoSxxExx) || nomeMinusculo.includes(padraoX)) {
                return true;
            }

            // Se for um pacote/pack de temporada, precisamos garantir que é da temporada certa
            // Ex: Se estamos na Temp 1, removemos títulos que mencionam explicitamente S02, S03, S04, S05...
            const contemOutraTemporada = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
                .filter(t => t !== tempOriginal)
                .some(t => {
                    const tStr = t.toString().padStart(2, '0');
                    return nomeMinusculo.includes(`s${tStr}`) || nomeMinusculo.includes(`${t}ª temporada`) || nomeMinusculo.includes(`season ${t}`);
                });

            if (contemOutraTemporada) {
                return false; // Descarta se for de outra temporada
            }

            // Se estamos no Episódio 1, removemos títulos que mencionam explicitamente OUTROS episódios isolados
            // Ex: Descarta se o título tiver "E02", "E03", mas aceita se for o "E01" ou se não especificar (Pack)
            const contemOutroEpisodio = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]
                .filter(e => e !== epOriginal)
                .some(e => {
                    const eStr = e.toString().padStart(2, '0');
                    return nomeMinusculo.includes(`e${eStr}`) || nomeMinusculo.includes(`x${eStr}`);
                });

            if (contemOutroEpisodio) {
                return false; // Descarta se for um episódio individual diferente do atual
            }

            // Se passou pelos filtros, mantém (pode ser temporada completa ou arquivo geral daquela temporada)
            return true;
        });
    }

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
