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

const manifest = {
    id: "community.betorbr.online",
    version: "1.0.11",
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

    // 1. Filtra pelo IMDb ID
    let resultados = torData.filter(item => item.imdb_id === imdbId);

    if (type === "movie") {
        // Para filmes: o único sinal confiável é NÃO ter seasons nem episodes.
        // O indexador às vezes cadastra filmes como item_type="tv" por engano,
        // então não filtramos por item_type — apenas excluímos o que claramente
        // é série (tem seasons ou episodes preenchidos).
        resultados = resultados.filter(item => {
            const temTemporada = item.seasons && item.seasons.length > 0;
            const temEpisodio  = item.episodes && item.episodes.length > 0;
            const nome = (item.torrent_name || "").toLowerCase();
            // Rejeita também se o nome deixa claro que é série
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

            // ESTRATÉGIA PRIMÁRIA: campos estruturados `episodes` (mais confiável)
            if (temEpisodio) {
                return item.episodes.some(ep => ep.season === sAlvo && ep.episode === eAlvo);
            }

            // ESTRATÉGIA SECUNDÁRIA: campo `seasons` (pack de temporada)
            if (temTemporada) {
                if (!item.seasons.includes(sAlvo)) return false;
                // Verifica se o nome limita a episódios específicos
                const epsMencionados = extrairEpisodiosDoNome(nome);
                if (epsMencionados.length === 0) return true; // Pack completo
                return epsMencionados.includes(eAlvo);
            }

            // FALLBACK: parse do nome (entradas sem campos estruturados)
            return filtrarPorNome(nome, sAlvo, eAlvo);
        });
    }

    if (resultados.length === 0) return { streams: [] };

    // 2. Formata os streams para o Stremio
    const streams = resultados
        .filter(item => item.torrent_name)
        .map(torrent => {
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
                title: `${torrent.torrent_name}\n👤 ${torrent.torrent_num_seeds || 0} Seeds`,
                infoHash: hash.toLowerCase()
            };
        })
        .filter(s => s !== null);

    return { streams };
});

// Extrai episódios explicitamente mencionados no nome do torrent.
// Ex: "S05E01-02" → [1,2] | "S05E04" → [4] | "S05 Pack" → []
function extrairEpisodiosDoNome(nome) {
    const eps = new Set();
    let m;

    // Range: s01e01-03 ou s01e01-e03
    const reRange = /s\d+e(\d+)[-–](?:e)?(\d+)/gi;
    while ((m = reRange.exec(nome)) !== null) {
        const ini = parseInt(m[1], 10), fim = parseInt(m[2], 10);
        for (let i = ini; i <= fim; i++) eps.add(i);
    }
    // Episódio único: s01e01
    const reSingle = /s\d+e(\d+)(?![-–\d])/gi;
    while ((m = reSingle.exec(nome)) !== null) eps.add(parseInt(m[1], 10));
    // Formato NxEE
    const reX = /\d+[xX](\d+)/g;
    while ((m = reX.exec(nome)) !== null) eps.add(parseInt(m[1], 10));
    // "ep 01" / "episode 01"
    const reEp = /ep(?:isode)?\s*(\d+)/gi;
    while ((m = reEp.exec(nome)) !== null) eps.add(parseInt(m[1], 10));

    return [...eps];
}

// Filtragem por nome para entradas sem campos estruturados (dados mais antigos).
function filtrarPorNome(nome, sAlvo, eAlvo) {
    // Episódio exato
    if (new RegExp(`s0*${sAlvo}\\s*e0*${eAlvo}(?!\\d)`, "i").test(nome)) return true;
    if (new RegExp(`\\b0*${sAlvo}[xX]0*${eAlvo}\\b`).test(nome)) return true;
    if (new RegExp(`season\\s*0*${sAlvo}\\s*ep(?:isode)?\\s*0*${eAlvo}\\b`, "i").test(nome)) return true;

    // Range de episódios no nome
    const matchRange = nome.match(new RegExp(`s0*${sAlvo}e(\\d+)[-–](?:e)?(\\d+)`, "i"));
    if (matchRange) {
        const ini = parseInt(matchRange[1], 10), fim = parseInt(matchRange[2], 10);
        if (eAlvo >= ini && eAlvo <= fim) return true;
    }

    // Pack de temporada completa
    const ehPackDaTemporada =
        new RegExp(`\\bs0*${sAlvo}\\b(?!\\s*e\\d)`, "i").test(nome) ||
        new RegExp(`season\\s*0*${sAlvo}\\b(?!\\s*ep)`, "i").test(nome) ||
        new RegExp(`temporada\\s*0*${sAlvo}\\b`, "i").test(nome) ||
        new RegExp(`0*${sAlvo}\\s*ª\\s*temporada`, "i").test(nome);

    if (!ehPackDaTemporada) return false;

    const epsMencionados = extrairEpisodiosDoNome(nome);
    if (epsMencionados.length === 0) return true;
    return epsMencionados.includes(eAlvo);
}

module.exports = builder.getInterface();
