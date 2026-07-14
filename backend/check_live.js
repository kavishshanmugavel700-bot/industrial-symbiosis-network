const axios = require('axios');

async function test() {
  const res = await axios.get('https://industrial-symbiosis-network.vercel.app/factory-schedule.html');
  const html = res.data;
  
  // Find the purchase-modal line
  const lines = html.split('\n');
  const modalLine = lines.find(l => l.includes('id="purchase-modal"'));
  console.log('Deployed Modal HTML Line:', modalLine ? modalLine.trim() : 'Not Found');
}

test().catch(console.error);
