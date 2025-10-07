const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(express.urlencoded({ extended: true }));

// 🔐 API KEY DIRETA (APENAS PARA TESTES)
const GROK_API_KEY = 'xai-1yLdNjM8eyzKn7T60Xl64MJeJU4FxSWDCNH9yQumLgFI6lnFKppV5uWihWdApQUdBKl8HwhKnqjJm131';
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const PORT = process.env.PORT || 3001;

// Log inicial
console.log('🚀 Iniciando Chunking Microservice');
console.log('📊 Configurações:', {
  port: PORT,
  grokApiConfigured: !!GROK_API_KEY,
  grokKeyPreview: GROK_API_KEY ? `${GROK_API_KEY.substring(0, 10)}...` : 'Não configurada'
});

// Health Check
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    service: 'chunking-microservice',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: 'GET /health',
      chunk: 'POST /chunk'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'chunking-microservice',
    timestamp: new Date().toISOString()
  });
});

// Endpoint principal de chunking
app.post('/chunk', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { content, chunkSize = 800, overlap = 100, strategy = 'intelligent' } = req.body;

    console.log(`\n🔄 NOVA REQUISIÇÃO DE CHUNKING`);
    console.log(`   Estratégia: ${strategy}`);
    console.log(`   Tamanho do conteúdo: ${content?.length || 0} caracteres`);

    // Validações
    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Conteúdo é obrigatório',
        chunks: [],
        chunkCount: 0
      });
    }

    if (content.length < 10) {
      console.log('📝 Conteúdo muito pequeno, retornando chunk único');
      return res.json({
        success: true,
        chunks: [content],
        chunkCount: 1,
        strategy: 'single_chunk',
        processingTime: Date.now() - startTime
      });
    }

    let chunks = [];
    let usedStrategy = strategy;

    // Decidir estratégia de chunking
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

    console.log(`✅ CHUNKING CONCLUÍDO`);
    console.log(`   Chunks gerados: ${chunks.length}`);
    console.log(`   Estratégia utilizada: ${usedStrategy}`);
    console.log(`   Tempo de processamento: ${processingTime}ms`);

    res.json({
      success: true,
      chunks: chunks,
      chunkCount: chunks.length,
      strategy: usedStrategy,
      contentLength: content.length,
      processingTime: processingTime,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('❌ ERRO NO CHUNKING:', error.message);
    
    // Fallback para chunking simples
    const fallbackChunks = simpleChunking(req.body.content || '', 800);
    
    res.json({
      success: true,
      chunks: fallbackChunks,
      chunkCount: fallbackChunks.length,
      strategy: 'fallback',
      error: error.message,
      processingTime: processingTime,
      timestamp: new Date().toISOString()
    });
  }
});

// Chunking inteligente com Grok API
async function intelligentChunking(content, chunkSize) {
  try {
    console.log('🤖 Chamando Grok API para chunking inteligente...');

    const response = await axios.post(GROK_API_URL, {
      model: 'grok-beta',
      messages: [
        {
          role: 'system',
          content: `Você é um especialista em divisão de texto. Divida o seguinte conteúdo em pedaços lógicos de aproximadamente ${chunkSize} tokens. 
Preserve os limites dos parágrafos e mantenha o contexto. 
Retorne APENAS um array JSON válido de strings, onde cada string é um chunk.
Exemplo: ["chunk 1 aqui", "chunk 2 aqui"]`
        },
        {
          role: 'user',
          content: content.length > 12000 ? content.substring(0, 12000) + '... [conteúdo truncado]' : content
        }
      ],
      temperature: 0.1,
      max_tokens: 4000
    }, {
      headers: {
        'Authorization': `Bearer ${GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 45000
    });

    console.log('✅ Resposta recebida do Grok');

    const chunksText = response.data.choices[0].message.content.trim();
    console.log('📄 Resposta do Grok (primeiros 200 chars):', chunksText.substring(0, 200));

    // Tentar parsear como JSON
    try {
      const chunks = JSON.parse(chunksText);
      if (Array.isArray(chunks) && chunks.length > 0) {
        const validChunks = chunks.filter(chunk => chunk && typeof chunk === 'string' && chunk.trim().length > 0);
        console.log(`📦 ${validChunks.length} chunks válidos parseados do Grok`);
        return validChunks;
      }
    } catch (parseError) {
      console.log('❌ Grok não retornou JSON válido, usando fallback...');
    }

    // Fallback: chunking simples
    console.log('🔄 Usando fallback para chunking simples');
    return simpleChunking(content, chunkSize);

  } catch (error) {
    console.error('❌ Erro na Grok API:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    throw new Error(`Falha no chunking inteligente: ${error.message}`);
  }
}

// Chunking simples por parágrafos
function simpleChunking(content, chunkSize) {
  console.log('📝 Aplicando chunking simples...');
  
  const cleanContent = content.replace(/\n{3,}/g, '\n\n').trim();
  const paragraphs = cleanContent.split('\n\n').filter(p => p.trim().length > 0);
  
  const chunks = [];
  let currentChunk = '';
  let currentSize = 0;

  for (const paragraph of paragraphs) {
    const paragraphSize = paragraph.length;
    
    if (currentSize + paragraphSize > chunkSize && currentSize > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
      currentSize = paragraphSize;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      currentSize += paragraphSize;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [content];
}

app.listen(PORT, () => {
  console.log(`🎯 Chunking Microservice rodando na porta ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`📝 Endpoint chunk: http://localhost:${PORT}/chunk`);
});