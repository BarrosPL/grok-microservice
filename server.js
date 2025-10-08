require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb' }));
app.use(cors());
app.use(express.urlencoded({ extended: true }));

// Configurações
const GROK_API_KEY = process.env.GROK_API_KEY;
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const PORT = process.env.PORT || 3001;

// Validação da API Key
if (!GROK_API_KEY) {
  console.error('❌ ERRO: GROK_API_KEY não encontrada');
  process.exit(1);
}

console.log('🚀 Microserviço de Chunking Iniciado');

// Health Check
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'chunking-microservice',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'chunking-microservice',
    timestamp: new Date().toISOString()
  });
});

// Endpoint principal ATUALIZADO - PRESERVA URL
app.post('/chunk', async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('📥 Request recebido no /chunk');
    
    // EXTRAIR CONTEÚDO E URL DE QUALQUER FORMATO
    let content = '';
    let chunkSize = 800;
    let strategy = 'intelligent';
    let sourceUrl = '';
    let originalUrl = '';
    let mainUrl = '';
    
    // Caso 1: Body é JSON object
    if (req.body && typeof req.body === 'object') {
      console.log('✅ Body é objeto JSON');
      content = req.body.content || req.body.text || req.body.data || '';
      chunkSize = req.body.chunkSize || 800;
      strategy = req.body.strategy || 'intelligent';
      
      // 🔥 EXTRAIR URLS PRINCIPAIS
      sourceUrl = req.body.sourceUrl || '';
      originalUrl = req.body.original_url || req.body.originalUrl || '';
      mainUrl = req.body.main_url || req.body.mainUrl || '';
    }
    // Caso 2: Body é string (JSON stringificado)
    else if (req.body && typeof req.body === 'string') {
      console.log('✅ Body é string, tentando parsear JSON...');
      try {
        const parsed = JSON.parse(req.body);
        content = parsed.content || parsed.text || parsed.data || '';
        chunkSize = parsed.chunkSize || 800;
        strategy = parsed.strategy || 'intelligent';
        
        // 🔥 EXTRAIR URLS PRINCIPAIS
        sourceUrl = parsed.sourceUrl || '';
        originalUrl = parsed.original_url || parsed.originalUrl || '';
        mainUrl = parsed.main_url || parsed.mainUrl || '';
      } catch (e) {
        console.log('⚠️ Não é JSON, usando string como conteúdo');
        content = req.body;
      }
    }
    
    // 🔥 DEFINIR URL PRINCIPAL (usar a mais confiável)
    const primaryUrl = mainUrl || originalUrl || sourceUrl || 'unknown';
    console.log(`📊 Conteúdo: ${content.length} caracteres`);
    console.log(`🌐 URL principal: ${primaryUrl}`);
    console.log(`🎯 Estratégia: ${strategy}`);
    
    // Se ainda estiver vazio, usar fallback
    if (!content || content.length < 10) {
      console.log('🔄 Conteúdo vazio, usando fallback');
      content = 'Conteúdo recebido vazio - necessário para processamento';
    }
    
    let chunks = [];
    let usedStrategy = strategy;
    
    // Aplicar chunking
    if (strategy === 'simple' || content.length < 500) {
      console.log('📝 Usando chunking simples');
      chunks = simpleChunking(content, chunkSize);
      usedStrategy = 'simple';
    } else {
      console.log('🧠 Usando chunking inteligente com Grok');
      chunks = await intelligentChunking(content, chunkSize);
      usedStrategy = 'intelligent';
    }
    
    const processingTime = Date.now() - startTime;
    
    console.log(`✅ Chunking concluído: ${chunks.length} chunks`);
    
    // 🔥 RETORNAR COM URL PRINCIPAL PRESERVADA
    res.json({
      success: true,
      chunks: chunks,
      chunkCount: chunks.length,
      sourceUrl: primaryUrl, // ← URL PRESERVADA
      original_url: primaryUrl, // ← BACKUP
      main_url: primaryUrl, // ← BACKUP
      strategy: usedStrategy,
      contentLength: content.length,
      processingTime: processingTime,
      timestamp: new Date().toISOString(),
      debug: {
        receivedContentLength: content.length,
        receivedStrategy: strategy,
        receivedUrl: primaryUrl
      }
    });
    
  } catch (error) {
    console.error('❌ ERRO NO CHUNKING:', error.message);
    
    // Fallback ROBUSTO com URL preservada
    let primaryUrl = 'unknown';
    let fallbackContent = '';
    
    if (typeof req.body === 'string') {
      fallbackContent = req.body;
      try {
        const parsed = JSON.parse(req.body);
        primaryUrl = parsed.sourceUrl || parsed.original_url || parsed.main_url || 'unknown';
      } catch (e) {
        // Não é JSON, manter URL como unknown
      }
    } else {
      fallbackContent = JSON.stringify(req.body);
      primaryUrl = req.body.sourceUrl || req.body.original_url || req.body.main_url || 'unknown';
    }
    
    const fallbackChunks = [fallbackContent.substring(0, 2000)];
    
    res.json({
      success: true,
      chunks: fallbackChunks,
      chunkCount: fallbackChunks.length,
      sourceUrl: primaryUrl, // ← URL PRESERVADA MESMO NO ERRO
      original_url: primaryUrl, // ← BACKUP
      main_url: primaryUrl, // ← BACKUP
      strategy: 'fallback',
      error: error.message,
      processingTime: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });
  }
});

// Chunking inteligente com Grok API
async function intelligentChunking(content, chunkSize) {
  try {
    console.log('🤖 Chamando Grok API...');
    
    const response = await axios.post(GROK_API_URL, {
      model: 'grok-beta',
      messages: [
        {
          role: 'system',
          content: `Split text into logical chunks of ~${chunkSize} tokens. Return ONLY JSON array.`
        },
        {
          role: 'user',
          content: content.substring(0, 10000)
        }
      ],
      temperature: 0.1,
      max_tokens: 3000
    }, {
      headers: {
        'Authorization': `Bearer ${GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const chunksText = response.data.choices[0].message.content.trim();
    
    try {
      const chunks = JSON.parse(chunksText);
      if (Array.isArray(chunks) && chunks.length > 0) {
        return chunks.filter(chunk => chunk && chunk.trim().length > 0);
      }
    } catch (e) {
      console.log('❌ Grok não retornou JSON válido');
    }
    
    return simpleChunking(content, chunkSize);
    
  } catch (error) {
    console.error('❌ Erro Grok API:', error.message);
    return simpleChunking(content, chunkSize);
  }
}

// Chunking simples
function simpleChunking(content, chunkSize) {
  const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0);
  const chunks = [];
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }
  
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks.length > 0 ? chunks : [content];
}

app.listen(PORT, () => {
  console.log(`🎯 Microserviço rodando na porta ${PORT}`);
  console.log(`🔗 Preserva URL principal em todas as respostas`);
});