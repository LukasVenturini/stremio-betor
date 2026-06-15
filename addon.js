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
    version: "1.0.9",
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

    // 1. Filtra inicialmente pelo ID do IMDb
    let resultados = torData.filter(item => item.imdb_id === imdbId);

    // 2. Se for SÉRIE, aplicamos a filtragem obrigatória de padrões
    if (type === "series" && partesId[1] && partesId[2]) {
        const sAlvo = parseInt(partesId[1], 10); 
        const eAlvo = parseInt(partesId[2], 10); 

        resultados = resultados.filter(item => {
            const nome = (item.torrent_name || "").toLowerCase();

            // Captura padrões de episódios (Ex: s01e01, 1x01, season 1 ep 1)
            const matchEp = nome.match(/s(\d+)\s*e(\d+)/i) || 
                            nome.match(/\b(\d+)[xX](\d+)\b/) || 
                            nome.match(/season\s*(\d+)\s*ep\s*(\d+)/i);

            // Captura padrões de temporadas isoladas/packs (Ex: s01, temporada 1, 1ª temporada)
            const matchTemp = nome.match(/\bs(\d+)\b/i) || 
                              nome.match(/season\s*(\d+)/i) || 
                              nome.match(/temporada\s*(\d+)/i) || 
                              nome.match(/(\d+)\s*ª\s*temporada/i);

            // --- DEFENSA ANTI-FILME INTRUSO ---
            // Se estamos em uma tela de série e o torrent não tem NENHUMA menção a temporada ou episódio,
            // é um filme intruso (como "A Noiva do Ano"). Eliminamos imediatamente!
            if (!matchEp && !matchTemp) {
                return false;
            }

            // Cenário 1: O torrent especificou o episódio exato
            if (matchEp) {
                const tempEncontrada = parseInt(matchEp[1], 10);
                const epEncontrado = parseInt(matchEp[2], 10);
                // Só aceita se a temporada E o episódio baterem com o que você clicou
                return tempEncontrada === sAlvo && epEncontrado === eAlvo;
            }

            // Cenário 2: O torrent é um Pack/Temporada Completa (não tem o ep isolado no título)
            if (matchTemp) {
                const tempEncontrada = parseInt(matchTemp[1], 10);
                
                // Se for de outra temporada (Ex: S05 vindo na busca da S01), descarta
                if (tempEncontrada !== sAlvo) return false;

                // Proteção extra: se o título do pacote mencionar explicitamente OUTRO episódio, barramos
                const contemOutroEpisodio = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
                    .filter(e => e !== eAlvo)
                    .some(e => {
                        const eStr = e.toString().padStart(2, '0');
                        return nome.includes(`e${eStr}`) || nome.includes(`x${eStr}`);
                    });

                if (contemOutroEpisodio) return false;

                return true;
            }

            return false;
        });
    }

    if (resultados.length === 0) return { streams: [] };

    // 3. Formata os resultados finais para o Stremio
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
