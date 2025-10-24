// filtrar_pois.ts
import fs from "fs";

/**
 * FILTRO INTELIGENTE DE POIs PARA INVESTIDORES
 * 
 * Remove POIs irrelevantes e mantém apenas locais estratégicos
 * para instalação de eletropostos
 */

interface POI {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  type: string;
  source: string;
}

interface Eletroposto {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  source: string;
}

// ============================================
// CONFIGURAÇÃO
// ============================================

const ARQUIVO_POIS_ORIGINAL = "pois_brasil.json";
const ARQUIVO_POIS_FILTRADO = "pois_brasil_filtrado.json";
const ARQUIVO_ELETROPOSTOS = "eletropostos_live.json";

// Limites geográficos do Brasil (com margem de segurança)
const BRASIL_BOUNDS = {
  latMin: -33.75,
  latMax: 5.27,
  lonMin: -73.99,
  lonMax: -34.79,
};

// ============================================
// CRITÉRIOS DE FILTRAGEM PARA INVESTIDORES
// ============================================

const CRITERIOS = {
  // 1. TIPOS ESTRATÉGICOS (alto valor para eletropostos)
  tiposEstrategicos: [
    "parking", // Estacionamentos = tempo de parada
    "fuel", // Postos de combustível = concorrentes + infraestrutura
    "gas_station",
    "supermarket", // Supermercados = tempo de parada + fluxo
    "shopping_mall", // Shoppings = alto fluxo + tempo
    "hotel", // Hotéis = pernoite + carregamento lento
    "motel",
    "rest_area", // Áreas de descanso = estratégico em rodovias
    "restaurant", // Restaurantes = tempo de parada
  ],

  // 2. PALAVRAS-CHAVE IMPORTANTES NO NOME
  palavrasChavePositivas: [
    "posto",
    "auto",
    "shopping",
    "hotel",
    "pousada",
    "motel",
    "restaurante",
    "estacionamento",
    "park",
    "rodovia",
    "br-",
    "supermercado",
    "hiper",
    "atacadão",
    "center",
    "plaza",
    "mall",
  ],

  // 3. PALAVRAS-CHAVE A EVITAR (baixa relevância)
  palavrasChaveNegativas: [
    "residencial",
    "casa",
    "apartamento",
    "lote",
    "terreno",
    "particular",
    "privado",
    "condomínio",
    "sem nome",
    "unnamed",
    "n/a",
    "desconhecido",
    "unknown",
  ],

  // 4. DISTÂNCIA MÍNIMA DE ELETROPOSTOS EXISTENTES (em km)
  distanciaMinimaDePosto: 5, // Não adianta abrir muito perto de outro

  // 5. NOME MÍNIMO (qualidade do dado)
  tamanhoMinimoNome: 3,
};

// ============================================
// FUNÇÕES DE FILTRAGEM
// ============================================

function estaNoBrasil(poi: POI): boolean {
  return (
    poi.latitude >= BRASIL_BOUNDS.latMin &&
    poi.latitude <= BRASIL_BOUNDS.latMax &&
    poi.longitude >= BRASIL_BOUNDS.lonMin &&
    poi.longitude <= BRASIL_BOUNDS.lonMax
  );
}

function tipoEstrategico(poi: POI): boolean {
  const tipo = poi.type?.toLowerCase() || "";
  return CRITERIOS.tiposEstrategicos.some((t) => tipo.includes(t));
}

function nomeValido(poi: POI): boolean {
  const nome = poi.name?.toLowerCase() || "";

  // Nome muito curto
  if (nome.length < CRITERIOS.tamanhoMinimoNome) return false;

  // Contém palavras negativas
  if (
    CRITERIOS.palavrasChaveNegativas.some((palavra) => nome.includes(palavra))
  ) {
    return false;
  }

  // Nomes genéricos demais
  if (
    nome === "outro" ||
    nome === "unknown" ||
    nome === "sem nome" ||
    nome === "n/a"
  ) {
    return false;
  }

  return true;
}

function temPalavraChavePositiva(poi: POI): boolean {
  const nome = poi.name?.toLowerCase() || "";
  return CRITERIOS.palavrasChavePositivas.some((palavra) =>
    nome.includes(palavra)
  );
}

function calcularDistancia(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Raio da Terra em km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function longeDeEletropostos(
  poi: POI,
  eletropostos: Eletroposto[]
): boolean {
  // Se não houver eletropostos carregados, aceita todos
  if (eletropostos.length === 0) return true;

  // Verifica se está longe o suficiente de todos os eletropostos
  for (const posto of eletropostos) {
    const dist = calcularDistancia(
      poi.latitude,
      poi.longitude,
      posto.latitude,
      posto.longitude
    );

    if (dist < CRITERIOS.distanciaMinimaDePosto) {
      return false; // Muito perto de um eletroposto existente
    }
  }

  return true;
}

function removerDuplicados(pois: POI[]): POI[] {
  const unicos = new Map<string, POI>();

  for (const poi of pois) {
    // Cria chave baseada em coordenadas arredondadas (precisão ~100m)
    const chave = `${Math.round(poi.latitude * 1000)}_${Math.round(
      poi.longitude * 1000
    )}`;

    // Se já existe, mantém o que tem melhor nome
    if (unicos.has(chave)) {
      const existente = unicos.get(chave)!;
      if (poi.name.length > existente.name.length) {
        unicos.set(chave, poi);
      }
    } else {
      unicos.set(chave, poi);
    }
  }

  return Array.from(unicos.values());
}

// ============================================
// ANÁLISE E PONTUAÇÃO
// ============================================

interface POIComScore extends POI {
  score: number;
  motivos: string[];
}

function calcularScore(poi: POI, eletropostos: Eletroposto[]): POIComScore {
  let score = 0;
  const motivos: string[] = [];

  // Pontuação por tipo
  const tipoScores: Record<string, number> = {
    fuel: 10, // Concorrente direto, ótima localização
    gas_station: 10,
    parking: 9, // Tempo de parada
    shopping_mall: 9, // Alto fluxo
    hotel: 8, // Pernoite
    supermarket: 7,
    rest_area: 7,
    restaurant: 6,
    motel: 6,
  };

  const tipoAtual = poi.type?.toLowerCase() || "";
  for (const [tipo, pontos] of Object.entries(tipoScores)) {
    if (tipoAtual.includes(tipo)) {
      score += pontos;
      motivos.push(`Tipo estratégico: ${tipo} (+${pontos})`);
      break;
    }
  }

  // Pontuação por palavras-chave no nome
  const nome = poi.name?.toLowerCase() || "";
  if (nome.includes("rodovia") || nome.includes("br-")) {
    score += 5;
    motivos.push("Localização em rodovia (+5)");
  }
  if (nome.includes("shopping") || nome.includes("mall")) {
    score += 4;
    motivos.push("Shopping/Mall (+4)");
  }
  if (nome.includes("hotel") || nome.includes("pousada")) {
    score += 3;
    motivos.push("Hotel/Pousada (+3)");
  }

  // Pontuação por distância de eletropostos existentes
  if (eletropostos.length > 0) {
    const distancias = eletropostos.map((e) =>
      calcularDistancia(poi.latitude, poi.longitude, e.latitude, e.longitude)
    );
    const menorDist = Math.min(...distancias);

    if (menorDist > 20) {
      score += 8;
      motivos.push(`Área sem cobertura: ${menorDist.toFixed(1)}km (+8)`);
    } else if (menorDist > 10) {
      score += 4;
      motivos.push(`Distante de postos: ${menorDist.toFixed(1)}km (+4)`);
    }
  }

  // Pontuação por qualidade do endereço
  if (poi.address && poi.address.length > 10) {
    score += 2;
    motivos.push("Endereço completo (+2)");
  }

  return { ...poi, score, motivos };
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("🎯 FILTRO INTELIGENTE DE POIs PARA INVESTIDORES");
  console.log("=".repeat(70) + "\n");

  // Carrega POIs originais
  if (!fs.existsSync(ARQUIVO_POIS_ORIGINAL)) {
    console.log("❌ Arquivo de POIs não encontrado:", ARQUIVO_POIS_ORIGINAL);
    return;
  }

  const poisOriginais: POI[] = JSON.parse(
    fs.readFileSync(ARQUIVO_POIS_ORIGINAL, "utf-8")
  );
  console.log(`📥 POIs originais: ${poisOriginais.length.toLocaleString()}`);

  // Carrega eletropostos existentes
  let eletropostos: Eletroposto[] = [];
  if (fs.existsSync(ARQUIVO_ELETROPOSTOS)) {
    eletropostos = JSON.parse(
      fs.readFileSync(ARQUIVO_ELETROPOSTOS, "utf-8")
    );
    console.log(
      `⚡ Eletropostos existentes: ${eletropostos.length.toLocaleString()}\n`
    );
  }

  // Estatísticas de filtragem
  const stats = {
    foraDoBrasil: 0,
    tipoInvalido: 0,
    nomeInvalido: 0,
    pertoDePosto: 0,
    duplicados: 0,
  };

  console.log("🔍 Aplicando filtros...\n");

  // FILTRO 1: Dentro do Brasil
  let poisFiltrados = poisOriginais.filter((poi) => {
    const valido = estaNoBrasil(poi);
    if (!valido) stats.foraDoBrasil++;
    return valido;
  });
  console.log(
    `✅ Filtro 1 (Geografia): ${poisFiltrados.length.toLocaleString()} (removidos: ${stats.foraDoBrasil.toLocaleString()})`
  );

  // FILTRO 2: Tipo estratégico
  poisFiltrados = poisFiltrados.filter((poi) => {
    const valido = tipoEstrategico(poi);
    if (!valido) stats.tipoInvalido++;
    return valido;
  });
  console.log(
    `✅ Filtro 2 (Tipo): ${poisFiltrados.length.toLocaleString()} (removidos: ${stats.tipoInvalido.toLocaleString()})`
  );

  // FILTRO 3: Nome válido
  poisFiltrados = poisFiltrados.filter((poi) => {
    const valido = nomeValido(poi);
    if (!valido) stats.nomeInvalido++;
    return valido;
  });
  console.log(
    `✅ Filtro 3 (Nome): ${poisFiltrados.length.toLocaleString()} (removidos: ${stats.nomeInvalido.toLocaleString()})`
  );

  // FILTRO 4: Longe de eletropostos
  const antesDuplicados = poisFiltrados.length;
  poisFiltrados = poisFiltrados.filter((poi) => {
    const valido = longeDeEletropostos(poi, eletropostos);
    if (!valido) stats.pertoDePosto++;
    return valido;
  });
  console.log(
    `✅ Filtro 4 (Distância): ${poisFiltrados.length.toLocaleString()} (removidos: ${stats.pertoDePosto.toLocaleString()})`
  );

  // FILTRO 5: Remove duplicados
  const antesDup = poisFiltrados.length;
  poisFiltrados = removerDuplicados(poisFiltrados);
  stats.duplicados = antesDup - poisFiltrados.length;
  console.log(
    `✅ Filtro 5 (Duplicados): ${poisFiltrados.length.toLocaleString()} (removidos: ${stats.duplicados.toLocaleString()})`
  );

  // Calcula scores
  console.log("\n📊 Calculando scores de atratividade...\n");
  const poisComScore = poisFiltrados
    .map((poi) => calcularScore(poi, eletropostos))
    .sort((a, b) => b.score - a.score);

  // Salva resultado
  fs.writeFileSync(
    ARQUIVO_POIS_FILTRADO,
    JSON.stringify(poisComScore, null, 2)
  );

  // Relatório final
  console.log("=".repeat(70));
  console.log("📈 RESULTADO FINAL");
  console.log("=".repeat(70));
  console.log(`\n🎯 POIs filtrados: ${poisComScore.length.toLocaleString()}`);
  console.log(
    `📉 Taxa de redução: ${(
      ((poisOriginais.length - poisComScore.length) / poisOriginais.length) *
      100
    ).toFixed(1)}%`
  );

  console.log("\n🏆 TOP 10 POIs MAIS ESTRATÉGICOS:\n");
  poisComScore.slice(0, 10).forEach((poi, i) => {
    console.log(`${i + 1}. ${poi.name} (Score: ${poi.score})`);
    console.log(`   Tipo: ${poi.type}`);
    console.log(`   Local: ${poi.address || "N/A"}`);
    console.log(`   Motivos: ${poi.motivos.join(", ")}`);
    console.log();
  });

  console.log("=".repeat(70));
  console.log(`\n✅ Arquivo salvo: ${ARQUIVO_POIS_FILTRADO}`);
  console.log("\n💡 Próximos passos:");
  console.log("   1. Revise o arquivo filtrado");
  console.log("   2. Ajuste os critérios se necessário");
  console.log("   3. Gere o mapa com: npx tsx visualizador.ts");
  console.log("=".repeat(70) + "\n");

  // Estatísticas por tipo
  console.log("📊 DISTRIBUIÇÃO POR TIPO:\n");
  const porTipo: Record<string, number> = {};
  poisComScore.forEach((poi) => {
    porTipo[poi.type] = (porTipo[poi.type] || 0) + 1;
  });
  Object.entries(porTipo)
    .sort((a, b) => b[1] - a[1])
    .forEach(([tipo, count]) => {
      console.log(`   ${tipo}: ${count.toLocaleString()}`);
    });

  console.log("\n");
}

main();