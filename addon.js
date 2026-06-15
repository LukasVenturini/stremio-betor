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
    version: "1.0.7",
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

    console.log(`[Stremio Cloud] Buscando fontes para ID: ${imdbId} | Tipo: ${type}`);

    // 1. Filtra inicialmente pelo ID do IMDb
    let resultados = torData.filter(item => item.imdb_id === imdbId);

    if (resultados.length === 0) return { streams: [] };

    // --- ALGORITMO DE VOTAÇÃO POR MAIORIA (ANTI-INTRUSO) ---
    const contagemPalavras = {};
    const termosIgnorados = new Set(["the", "dos", "com", "para", "dual", "dublado", "web", "dl", "bluray", "h264", "x264", "x265", "1080p", "720p", "4k", "temporada", "season", "completa", "pack", "complete"]);

    // Conta a frequência de cada palavra em TODOS os resultados do mesmo ID
    resultados.forEach(item => {
        const nome = (item.torrent_name || "").toLowerCase();
        const tituloBase = nome.split(/(?:\d{4}|1080p|720p|4k|bluray|web\-dl|h264|x264|x265|dual|dublado)/i)[0];
        const palavras = tituloBase.replace(/[\.\-_,:\(\)\[\]]/g, " ").split(/\s+/);
        
        palavras.forEach(p => {
            if (p.length > 2 && !termosIgnorados.has(p)) {
                contagemPalavras[p] = (contagemPalavras[p] || 0) + 1;
            }
        });
    });

    // Descobre qual é a palavra campeã de acessos (o nome real da série)
    let palavraChaveReal = "";
    let maiorFrequencia = 0;
    for (const [palavra, freq] of Object.entries(contagemPalavras)) {
        if (freq > maiorFrequencia) {
            maiorFrequencia = freq;
            palavraChaveReal = palavra;
        }
    }

    // Só ativa a trava de nome se houver um padrão claro de repetição (catálogo limpo)
    const usarFiltroNome = maiorFrequencia >= Math.max(2, Math.floor(resultados.length * 0.20)) && palavraChaveReal;
    if (usarFiltroNome) {
        console.log(`[Filtro] Palavra-chave soberana identificada para este ID: "${palavraChaveReal}"`);
    }

    // 2. Se for SÉRIE, aplica os filtros matemáticos cruzados com a palavra soberana
    if (type === "series" && partesId[1] && partesId[2]) {
        const sAlvo = parseInt(partesId[1], 10); 
        const eAlvo = parseInt(partesId[2], 10); 

        const regexEpisodio = /(?:s|season\s*)(\d+)\s*(?:e|x|ep\s*)(\d+)/i;
        const regexPackTemporada = /(?:s|season\s*|temporada\s*)(\d+)/i;

        resultados = resultados.filter(item => {
            const nomeTorrent = (item.torrent_name || "").toLowerCase();

            // Regra de Ouro: Se o torrent não tiver a palavra mais votada do ID (Ex: "boys"), ele é descartado na hora
            if (usarFiltroNome && !nomeTorrent.replace(/[\.\-_]/g, " ").includes(palavraChaveReal)) {
                return false; 
            }

            // Checa primeiro os arquivos internos (se for um Pack com lista detalhada)
            if (item.torrent_files && Array.isArray(item.torrent_files)) {
                const temEpNosArquivos = item.torrent_files.some(f => {
                    const match = f.toLowerCase().match(regexEpisodio);
                    return match && parseInt(match[1], 10) === sAlvo && parseInt(match[2], 10) === eAlvo;
                });
                if (temEpNosArquivos) return true;
            }

            // Checa o nome principal do Torrent buscando o episódio exato
            const matchEp = nomeTorrent.match(regexEpisodio);
            if (matchEp) {
                return parseInt(matchEp[1], 10) === sAlvo && parseInt(matchEp[2], 10) === eAlvo;
            }

            // Checa se é um Pack/Temporada Completa da temporada correta
            const matchTemp = nomeTorrent.match(regexPackTemporada);
            if (matchTemp) {
                const tEncontrada = parseInt(matchTemp[1], 10);
                const ehPack = nomeTorrent.includes("completa") || nomeTorrent.includes("pack") || nomeTorrent.includes("complete") || nomeTorrent.includes("temporada");
                
                // Aceita se for a temporada certa e for um pacote de episódios
                if (tEncontrada === sAlvo && (ehPack || (!nomeTorrent.includes("e0") && !nomeTorrent.includes("e1")))) {
                    return true;
                }
            }

            return false;
        });
    }

    if (resultados.length === 0) return { streams: [] };

    // 3. Formata os resultados finais para o Stremio
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
