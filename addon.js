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
    version: "1.0.2",
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
    const tempNum = parseInt(partesId[1], 10); // Transforma em número puro (Ex: 1)
    const epNum = parseInt(partesId[2], 10);   // Transforma em número puro (Ex: 1)

    console.log(`[Stremio Cloud] Buscando fontes para ID: ${imdbId} | Tipo: ${type}`);

    // 1. Filtra inicialmente pelo ID principal no IMDb
    let resultados = torData.filter(item => item.imdb_id === imdbId);

    // 2. Se for série, aplica a filtragem com precisão matemática por RegEx
    if (type === "series" && !isNaN(tempNum) && !isNaN(epNum)) {
        console.log(`Filtrando série: Temporada ${tempNum}, Episódio ${epNum}`);

        resultados = resultados.filter(item => {
            const nomeMinusculo = (item.torrent_name || "").toLowerCase();
            
            // Regex 1: Procura por padrões de episódio exato: s01e01, s1e1, 1x01, 01x01
            // Captura os números isolados para podermos comparar matematicamente
            const regexEpisodio = /(?:s|)(\d+)(?:e|x)(\d+)/i;
            const matchEp = nomeMinusculo.match(regexEpisodio);

            if (matchEp) {
                const tEncontrada = parseInt(matchEp[1], 10);
                const eEncontrado = parseInt(matchEp[2], 10);
                // Só aceita se for EXATAMENTE a temporada E o episódio que você clicou
                return tEncontrada === tempNum && eEncontrado === epNum;
            }

            // Regex 2: Se não achou o episódio isolado, vê se é um Pack/Temporada Completa
            // Procura por s01, s1, 1ª temporada, temporada 1, season 1
            const regexTemporadaCompleta = /(?:s|season\s*|temporada\s*)(\d+)/i;
            const matchTemp = nomeMinusculo.match(regexTemporadaCompleta);

            if (matchTemp) {
                const tEncontrada = parseInt(matchTemp[1], 10);
                // Verifica se a temporada bate E se o título indica que é um pacote completo
                const ehPack = nomeMinusculo.includes("completa") || 
                              nomeMinusculo.includes("complete") || 
                              nomeMinusculo.includes("pack") || 
                              nomeMinusculo.includes("temporada");
                
                return tEncontrada === tempNum && ehPack;
            }

            // Se tiver arquivos internos detalhados no JSON, faz uma checagem rápida neles
            if (item.torrent_files) {
                const padraoEp = `s${tempNum.toString().padStart(2, '0')}e${epNum.toString().padStart(2, '0')}`;
                return item.torrent_files.some(f => f.toLowerCase().includes(padraoEp));
            }

            return false;
        });
    }

    if (resultados.length === 0) return { streams: [] };

    // Transforma os dados no formato exato exigido pelo Stremio
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
