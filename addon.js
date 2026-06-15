const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

// Coloque aqui a URL direta do items.json que você achou no site do BeTor
// Exemplo: "https://betor.pub/data/items.json" ou a URL correta do domínio deles
const URL_ITEMS_BETOR = "https://catalogo.betor.top/static/data/items.json"; 

let torData = [];

// Função que baixa os dados do BeTor para a memória ao iniciar
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

// Inicializa a carga de dados imediatamente ao rodar o script
carregarDadosBeTor();

const manifest = {
    id: "community.betorbr.online",
    version: "1.0.0",
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
    const temporada = partesId[1];
    const episodio = partesId[2];

    console.log(`[Stremio Cloud] Buscando fontes para ID: ${imdbId} | Tipo: ${type}`);

    // 1. Filtra inicialmente pelo ID principal da série/filme no IMDb
    let resultados = torData.filter(item => item.imdb_id === imdbId);

    // 2. Se for uma série, aplica a filtragem inteligente de episódios e temporadas completas
    if (type === "series" && temporada && episodio) {
        console.log(`Filtrando série: Temporada ${temporada}, Episódio ${episódio}`);
        
        // Padrões de Episódio Individual (Ex: s01e01, 1x01, e01)
        const padraoSxxExx = `s${temporada.padStart(2, '0')}e${episodio.padStart(2, '0')}`; 
        const padraoX = `${temporada}x${episodio.padStart(2, '0')}`;
        const padraoEpisodioSolto = `e${episodio.padStart(2, '0')}`;

        // Padrões de Temporada Completa (Ex: s01, season 1, 1ª temporada, completa)
        const padraoForteTemporada = `s${temporada.padStart(2, '0')}`; // s01 (sem o 'e')
        const padraoTextoTemporada = `${temporada}ª temporada`; // 1ª temporada
        const padraoSeason = `season ${temporada}`; // season 1

        resultados = resultados.filter(item => {
            const nomeMinusculo = (item.torrent_name || "").toLowerCase();
            
            // Verifica se o termo aparece nos arquivos internos do torrent (se existirem)
            const contemNosArquivosInternos = item.torrent_files && item.torrent_files.some(f => {
                const fMin = f.toLowerCase();
                return fMin.includes(padraoSxxExx) || fMin.includes(padraoX);
            });

            // Regra 1: É o episódio exato?
            const ehEpisodioExato = nomeMinusculo.includes(padraoSxxExx) || 
                                    nomeMinusculo.includes(padraoX) || 
                                    contemNosArquivosInternos;

            // Regra 2: É um pacote completo da temporada atual?
            // (Checa se cita a temporada E palavras chave de pacotes, evitando misturar com outras temporadas)
            const ehTemporadaCompleta = (nomeMinusculo.includes(padraoForteTemporada) || nomeMinusculo.includes(padraoTextoTemporada) || nomeMinusculo.includes(padraoSeason)) && 
                                        (nomeMinusculo.includes("completa") || nomeMinusculo.includes("complete") || nomeMinusculo.includes("pack") || !nomeMinusculo.includes("e0"));

            // Se for o episódio exato OU o pacote completo daquela temporada, nós mostramos!
            return ehEpisodioExato || ehTemporadaCompleta;
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
