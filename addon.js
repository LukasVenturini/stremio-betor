const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

const URL_ITEMS_BETOR = "https://catalogo.betor.top/static/data/items.json";

let torData = [];

async function carregarDadosBeTor() {
    try {
        console.log("Baixando banco de dados atualizado do BeTor...");
        const response = await axios.get(URL_ITEMS_BETOR);
        torData = response.data || [];
        console.log(`Banco de dados carregado! Itens: ${torData.length}`);
    } catch (error) {
        console.error("Erro crítico ao baixar dados do BeTor:", error.message);
    }
}
carregarDadosBeTor();

// Atualiza o banco automaticamente a cada 24 horas
const INTERVALO_24H = 24 * 60 * 60 * 1000;
setInterval(carregarDadosBeTor, INTERVALO_24H);

const manifest = {
    id: "community.betorbr.online",
    version: "1.0.12",
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

    // 1. Filtra pelo IMDb ID — e já descarta entradas sem torrent_name E sem episodes
    //    (dados incompletos do indexador que causam falsos positivos)
    let resultados = torData.filter(item =>
        item.imdb_id === imdbId && (item.torrent_name || (item.episodes && item.episodes.length > 0))
    );

    if (type === "movie") {
        // Para filmes: exclui qualquer entrada que claramente é série
        // (não filtramos por item_type porque o indexador cadastra filmes como "tv" às vezes)
        resultados = resultados.filter(item => {
            const temTemporada = item.seasons && item.seasons.length > 0;
            const temEpisodio  = item.episodes && item.episodes.length > 0;
            const nome = (item.torrent_name || "").toLowerCase();
            const nomeTemSerie = /s\d{1,2}e\d{1,2}|\bseason\s*\d|\btemporada\s*\d|\d+[xX]\d{2}/.test(nome);
            return !temTemporada && !temEpisodio && !nomeTemSerie;
        });
    }

    if (type === "series" && partesId[1] && partesId[2]) {
        const sAlvo = parseInt(partesId[1], 10);
        const eAlvo = parseInt(partesId[2], 10);

        resultados = resultados.filter(item => {
            const temTemporada = item.seasons && item.seasons.length > 0;
            const temEpisodio  = item.episodes && item.episodes.length > 0;
            const nome = (item.torrent_name || "").toLowerCase();
            const nomeTemIndicacao = /s\d+|season\s*\d+|temporada\s*\d+|\d+[xX]\d+|\bep\s*\d+/i.test(nome);

            // Sem nenhuma indicação de série → filme intruso, descarta
            if (!temTemporada && !temEpisodio && !nomeTemIndicacao) return false;

            // ESTRATÉGIA 1: campo episodes[] estruturado (mais confiável)
            if (temEpisodio) {
                return item.episodes.some(ep => ep.season === sAlvo && ep.episode === eAlvo);
            }

            // ESTRATÉGIA 2: campo seasons[] + episódio identificado pelo nome
            if (temTemporada) {
                if (!item.seasons.includes(sAlvo)) return false;

                const epsMencionados = extrairEpisodiosDoNome(nome);

                // Pack sem nenhum episódio identificável no nome:
                // só aprovamos se o nome NÃO contiver padrão SxxExx de outro ep,
                // o que indicaria que é realmente um pack completo sem ep no título
                // (ex: "The Boys S05 Completo") — mas se o nome é vazio ou genérico
                // sem qualquer ep, não temos como saber: descartamos para evitar falso positivo
                if (epsMencionados.length === 0) {
                    // Aceita apenas se o nome contiver indicação de pack/completo
                    // e NÃO contiver padrão de episódio isolado que simplesmente não parseamos
                    const ehPackExplicito = /\b(completo|complete|pack|full.?season|temporada.?completa)\b/i.test(nome);
                    return ehPackExplicito;
                }

                return epsMencionados.includes(eAlvo);
            }

            // ESTRATÉGIA 3: fallback — parse do nome para entradas sem campos estruturados
            return filtrarPorNome(nome, sAlvo, eAlvo);
        });
    }

    if (resultados.length === 0) return { streams: [] };

    // 2. Formata os streams para o Stremio
    const streams = resultados.map(torrent => {
        let hash = null;

        if (torrent.magnet_xt) {
            const match = torrent.magnet_xt.match(/btih:([a-fA-F0-9]{40})/i);
            if (match) hash = match[1];
            if (!hash) hash = torrent.magnet_xt.split(":").pop();
        }
        if (!hash && torrent.magnet_uri) {
            const match = torrent.magnet_uri.match(/btih:([a-fA-F0-9]{40})/i);
            if (match) hash = match[1];
        }

        if (!hash || hash.length < 40) return null;

        return {
            name: `BeTor\n[${torrent.provider_slug || "BeTor"}]`,
            title: `${torrent.torrent_name || "Sem título"}\n👤 ${torrent.torrent_num_seeds || 0} Seeds`,
            infoHash: hash.toLowerCase()
        };
    }).filter(s => s !== null);

    return { streams };
});

// Extrai todos os números de episódios mencionados explicitamente no nome.
// Ex: "S05E01-02" → [1,2] | "S05E04" → [4] | "S05 Completo" → []
function extrairEpisodiosDoNome(nome) {
    const eps = new Set();
    let m;

    // Range: s01e01-03 ou s01e01-e03
    const reRange = /s\d+e(\d+)[-–](?:e)?(\d+)/gi;
    while ((m = reRange.exec(nome)) !== null) {
        const ini = parseInt(m[1], 10), fim = parseInt(m[2], 10);
        for (let i = ini; i <= fim; i++) eps.add(i);
    }
    // Episódio único: s01e04
    const reSingle = /s\d+e(\d+)(?![-–\d])/gi;
    while ((m = reSingle.exec(nome)) !== null) eps.add(parseInt(m[1], 10));
    // Formato 1x04
    const reX = /\d+[xX](\d+)/g;
    while ((m = reX.exec(nome)) !== null) eps.add(parseInt(m[1], 10));
    // "ep 04" / "episode 04"
    const reEp = /ep(?:isode)?\s*(\d+)/gi;
    while ((m = reEp.exec(nome)) !== null) eps.add(parseInt(m[1], 10));

    return [...eps];
}

// Filtragem por nome para entradas sem campos estruturados (dados legados).
function filtrarPorNome(nome, sAlvo, eAlvo) {
    // Episódio exato: s01e01, 1x01, season 1 ep 1
    if (new RegExp(`s0*${sAlvo}\\s*e0*${eAlvo}(?!\\d)`, "i").test(nome)) return true;
    if (new RegExp(`\\b0*${sAlvo}[xX]0*${eAlvo}\\b`).test(nome)) return true;
    if (new RegExp(`season\\s*0*${sAlvo}\\s*ep(?:isode)?\\s*0*${eAlvo}\\b`, "i").test(nome)) return true;

    // Range no nome: s01e01-03
    const matchRange = nome.match(new RegExp(`s0*${sAlvo}e(\\d+)[-–](?:e)?(\\d+)`, "i"));
    if (matchRange) {
        const ini = parseInt(matchRange[1], 10), fim = parseInt(matchRange[2], 10);
        if (eAlvo >= ini && eAlvo <= fim) return true;
    }

    // Pack de temporada completa
    const ehPack =
        new RegExp(`\\bs0*${sAlvo}\\b(?!\\s*e\\d)`, "i").test(nome) ||
        new RegExp(`season\\s*0*${sAlvo}\\b(?!\\s*ep)`, "i").test(nome) ||
        new RegExp(`temporada\\s*0*${sAlvo}\\b`, "i").test(nome) ||
        new RegExp(`0*${sAlvo}\\s*ª\\s*temporada`, "i").test(nome);

    if (!ehPack) return false;

    const epsMencionados = extrairEpisodiosDoNome(nome);
    if (epsMencionados.length === 0) {
        // Pack sem ep no nome — só aceita se for explicitamente "completo"
        return /\b(completo|complete|pack|full.?season|temporada.?completa)\b/i.test(nome);
    }
    return epsMencionados.includes(eAlvo);
}

module.exports = builder.getInterface();
