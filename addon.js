const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

// Coloque aqui a URL direta do items.json do BeTor
const URL_ITEMS_BETOR = "https://catalogo.betor.top/static/data/items.json"; 

let torData = [];

async function carregarDadosBeTor() {
    try {
        console.log("Baixando banco de dados updated do BeTor...");
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
    version: "1.0.4",
    name: "BeTor v3 Oficial",
    description: "Busca torrents brasileiros direto do catálogo atualizado do BeTor",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

// Função auxiliar para tentar extrair e limpar o nome base de um título do torrent
function extrairNomeBase(torrentName) {
    if (!torrentName) return "";
    // Remove tudo após o ano, resolução ou termos comuns de torrent para tentar isolar o nome da obra
    let nome = torrentName.split(/(?:\d{4}|1080p|720p|4k|bluray|web-dl|h264|dual|dublado)/i)[0];
    return nome.replace(/[\.\-_]/g, " ").trim().toLowerCase();
}

builder.defineStreamHandler(async ({ type, id }) => {
    const partesId = id.split(":");
    const imdbId = partesId[0]; 
    const temporada = partesId[1]; 
    const episodio = partesId[2];  

    console.log(`[Stremio Cloud] Buscando fontes para ID: ${imdbId} | Tipo: ${type}`);

    // 1. Filtra inicialmente pelo ID do IMDb
    let resultados = torData.filter(item => item.imdb_id === imdbId);

    if (resultados.length === 0) return { streams: [] };

    // Se encontramos resultados, usamos o nome do primeiro item válido como referência de nome da série/filme
    // Isso ajuda a eliminar itens com títulos totalmente diferentes cadastrados com o mesmo IMDb ID por erro
    const primeiroItemValido = resultados.find(item => item.torrent_name);
    let nomeReferencia = "";
    if (primeiroItemValido) {
        nomeReferencia = extrairNomeBase(primeiroItemValido.torrent_name);
        // Garante um tamanho mínimo significativo para evitar falsos positivos com nomes curtos
        if (nomeReferencia.length < 3) nomeReferencia = ""; 
    }

    // 2. Aplica as regras de filtragem rigorosas
    resultados = resultados.filter(item => {
        const nomeTorrent = (item.torrent_name || "").toLowerCase();
        const nomeTorrentLimpo = nomeTorrent.replace(/[\.\-_]/g, " ");

        // Proteção contra erro de ID do BeTor: Se o torrent tiver um nome totalmente desalinhado da referência, descarta
        if (nomeReferencia && !nomeTorrentLimpo.includes(nomeReferencia)) {
            // Caso especial: pode ser que o primeiro item seja o intruso, então vamos testar se o termo "boys" (ou o termo da série) faz sentido, 
            // mas de forma geral, isso corta filmes aleatórios perfeitamente.
            if (type === "series" && !nomeTorrentLimpo.includes("the boys") && nomeReferencia.includes("boys")) {
                return false;
            }
        }

        // Se for série, filtra episódios e temporadas
        if (type === "series" && temporada && episodio) {
            const tempOriginal = parseInt(temporada, 10);
            const epOriginal = parseInt(episodio, 10);
            
            const padraoSxxExx = `s${temporada.padStart(2, '0')}e${episodio.padStart(2, '0')}`; 
            const padraoX = `${temporada}x${episodio.padStart(2, '0')}`; 

            // Se tiver o código exato do episódio atual, aceita direto
            if (nomeTorrent.includes(padraoSxxExx) || nomeTorrent.includes(padraoX)) {
                return true;
            }

            // Exclusão de outras temporadas para evitar misturar S05 com S01
            const contemOutraTemporada = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
                .filter(t => t !== tempOriginal)
                .some(t => {
                    const tStr = t.toString().padStart(2, '0');
                    return nomeTorrent.includes(`s${tStr}`) || nomeTorrent.includes(`${t}ª temporada`) || nomeTorrent.includes(`season ${t}`);
                });

            if (contemOutraTemporada) return false;

            // Exclusão de outros episódios individuais (se tiver "e02" estando no ep 1, pula)
            const contemOutroEpisodio = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]
                .filter(e => e !== epOriginal)
                .some(e => {
                    const eStr = e.toString().padStart(2, '0');
                    return nomeTorrent.includes(`e${eStr}`) || nomeTorrent.includes(`x${eStr}`);
                });

            if (contemOutroEpisodio) return false;

            // Garante que o item de série tenha pelo menos alguma menção a episódio, temporada, completa ou pack 
            // para evitar que filmes soltos entrem aqui de penetra
            const termoDeSerie = nomeTorrent.includes("temporada") || nomeTorrent.includes("s0") || nomeTorrent.includes("season") || nomeTorrent.includes("completa") || nomeTorrent.includes("pack");
            if (!termoDeSerie && !nomeTorrent.includes(`e${episodio.padStart(2, '0')}`)) {
                return false;
            }
        }

        return true;
    });

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
