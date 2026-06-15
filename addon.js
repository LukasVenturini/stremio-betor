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
    version: "1.0.6",
    name: "BeTor v3 Oficial",
    description: "Busca torrents brasileiros direto do catálogo atualizado do BeTor",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

// Função para tentar limpar o título e pegar palavras-chave da obra
function obterPalavrasChave(texto) {
    if (!texto) return [];
    let limpo = texto.toLowerCase()
        .split(/(?:\d{4}|1080p|720p|4k|bluray|web\-dl|h264|x264|x265|dual|dublado|temporada|season|s\d+e\d+)/i)[0];
    limpo = limpo.replace(/[\.\-_,:\(\)]/g, " ");
    return limpo.split(/\s+/).filter(p => p.length > 2 && p !== "the" && p !== "dos" && p !== "com");
}

builder.defineStreamHandler(async ({ type, id }) => {
    const partesId = id.split(":");
    const imdbId = partesId[0]; 

    console.log(`[Stremio Cloud] Buscando fontes para ID: ${imdbId} | Tipo: ${type}`);

    // 1. Filtra inicialmente pelo ID do IMDb
    let resultados = torData.filter(item => item.imdb_id === imdbId);

    if (resultados.length === 0) return { streams: [] };

    // Tenta descobrir o nome real da série baseado nos títulos mais frequentes para esse ID
    let palavrasChaveObra = [];
    if (resultados.length > 0) {
        // Pega os 3 primeiros títulos para analisar
        const amostras = resultados.slice(0, 3).map(r => r.torrent_name || "");
        for (const amostra of amostras) {
            const palavras = obterPalavrasChave(amostra);
            if (palavras.length > 0) {
                palavrasChaveObra = palavras;
                break;
            }
        }
    }

    // 2. Se for SÉRIE, aplicamos a filtragem inteligente matemática + validação de palavras-chave
    if (type === "series" && partesId[1] && partesId[2]) {
        const sAlvo = parseInt(partesId[1], 10); 
        const eAlvo = parseInt(partesId[2], 10); 

        const regexEpisodio = /(?:s|season\s*)(\d+)\s*(?:e|x|ep\s*)(\d+)/i;
        const regexPackTemporada = /(?:s|season\s*|temporada\s*)(\d+)/i;

        resultados = resultados.filter(item => {
            const nomeTorrent = (item.torrent_name || "").toLowerCase();
            const nomeTorrentLimpo = nomeTorrent.replace(/[\.\-_]/g, " ");

            // Validação de segurança anti-intruso:
            // Se descobrimos palavras-chave da série (ex: ["boys"]), o torrent obrigatoriamente precisa ter essa palavra.
            // Isso elimina séries aleatórias (como "Off Campus") cadastradas com o ID errado.
            if (palavrasChaveObra.length > 0) {
                const temPalavraChave = palavrasChaveObra.some(p => nomeTorrentLimpo.includes(p));
                if (!temPalavraChave) return false; 
            }

            const textosParaVerificar = [nomeTorrent];
            if (item.torrent_files && Array.isArray(item.torrent_files)) {
                item.torrent_files.forEach(f => textosParaVerificar.push(f.toLowerCase()));
            }

            let encontradoParaOEpisodio = false;
            let ehPackDaTemporadaCerta = false;

            for (const texto of textosParaVerificar) {
                // Teste 1: Episódio exato (S01E01)
                const matchEp = texto.match(regexEpisodio);
                if (matchEp) {
                    const tEncontrada = parseInt(matchEp[1], 10);
                    const eEncontrado = parseInt(matchEp[2], 10);
                    if (tEncontrada === sAlvo && eEncontrado === eAlvo) {
                        encontradoParaOEpisodio = true;
                        break;
                    }
                }

                // Teste 2: Pack da temporada inteira correta
                const matchTemp = texto.match(regexPackTemporada);
                if (matchTemp) {
                    const tEncontrada = parseInt(matchTemp[1], 10);
                    const ehManualPack = nomeTorrent.includes("completa") || nomeTorrent.includes("pack") || nomeTorrent.includes("complete") || nomeTorrent.includes("temporada");
                    
                    if (tEncontrada === sAlvo && ehManualPack) {
                        ehPackDaTemporadaCerta = true;
                        break;
                    }
                }
            }

            return encontradoParaOEpisodio || ehPackDaTemporadaCerta;
        });
    }

    if (resultados.length === 0) return { streams: [] };

    // 3. Formata os resultados para o Stremio
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
