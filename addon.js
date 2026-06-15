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
    version: "1.0.10",
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

    // 2. Para séries, aplica filtragem por temporada/episódio
    if (type === "series" && partesId[1] && partesId[2]) {
        const sAlvo = parseInt(partesId[1], 10);
        const eAlvo = parseInt(partesId[2], 10);

        // Monta strings de busca com padding (ex: "01", "1")
        const sStr  = sAlvo.toString().padStart(2, "0");
        const eStr  = eAlvo.toString().padStart(2, "0");

        resultados = resultados.filter(item => {
            const nome = (item.torrent_name || "").toLowerCase();

            // ----- Padrão 1: episódio exato -----
            // Aceita: s01e01, s1e1, 1x01, 01x01, season 1 ep 1, season 1 episode 1
            const matchEpExato =
                new RegExp(`s0*${sAlvo}\\s*e0*${eAlvo}\\b`, "i").test(nome) ||
                new RegExp(`\\b0*${sAlvo}[xX]0*${eAlvo}\\b`).test(nome) ||
                new RegExp(`season\\s*0*${sAlvo}\\s*ep(?:isode)?\\s*0*${eAlvo}\\b`, "i").test(nome);

            if (matchEpExato) return true;

            // ----- Padrão 2: pack/temporada completa -----
            // Aceita: s01 (sem episódio), temporada 1, 1ª temporada, season 1
            // MAS rejeita se houver qualquer menção a episódio específico DIFERENTE do alvo
            const matchTemporada =
                new RegExp(`\\bs0*${sAlvo}\\b(?!\\s*e\\d)`, "i").test(nome) ||
                new RegExp(`season\\s*0*${sAlvo}\\b(?!\\s*ep)`, "i").test(nome) ||
                new RegExp(`temporada\\s*0*${sAlvo}\\b`, "i").test(nome) ||
                new RegExp(`0*${sAlvo}\\s*ª\\s*temporada`, "i").test(nome);

            if (!matchTemporada) {
                // Sem indicação nenhuma de temporada → pode ser filme intruso
                return false;
            }

            // É um pack da temporada certa. Verifica se o título menciona
            // episódios específicos que NÃO incluem o nosso alvo.
            // Ex: "S01E05-E08" — se o alvo for E03, descarta.
            // Extrai TODOS os números de episódios explicitamente citados no nome.
            const epsMencionados = [];
            let m;

            // Padrão s01eXX
            const reEp1 = /s\d+\s*e(\d+)/gi;
            while ((m = reEp1.exec(nome)) !== null) {
                epsMencionados.push(parseInt(m[1], 10));
            }

            // Padrão NxXX
            const reEp2 = /\d+[xX](\d+)/g;
            while ((m = reEp2.exec(nome)) !== null) {
                epsMencionados.push(parseInt(m[1], 10));
            }

            // Padrão ep/episode XX
            const reEp3 = /ep(?:isode)?\s*(\d+)/gi;
            while ((m = reEp3.exec(nome)) !== null) {
                epsMencionados.push(parseInt(m[1], 10));
            }

            if (epsMencionados.length === 0) {
                // Pack sem episódio específico → temporada completa → inclui
                return true;
            }

            // Se tem episódios mencionados, o alvo deve estar entre eles
            return epsMencionados.includes(eAlvo);
        });
    }

    if (resultados.length === 0) return { streams: [] };

    // 3. Formata os streams para o Stremio
    const streams = resultados.map(torrent => {
        // Tenta extrair o hash do magnet_xt ou do magnet_uri
        let hash = null;

        if (torrent.magnet_xt) {
            const parts = torrent.magnet_xt.split(":");
            hash = parts[parts.length - 1];
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
    }).filter(s => s !== null);

    return { streams };
});

module.exports = builder.getInterface();
