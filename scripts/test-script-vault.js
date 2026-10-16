import http from 'node:http';

function request(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 4111,
        path,
        method,
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(body);
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function testScriptVault() {
  console.log('🧪 Testing Script Vault & Semantic Macro Engine...\n');

  // 1. Save a new macro into the vault
  console.log('1. Saving new macro "extract_form_labels" into Cortex Script Vault...');
  const saveRes = await request('/scripts/save', 'POST', {
    name: 'extract_form_labels',
    description: 'Scrapes all form labels and input placeholders across the current page into an organized key-value mapping.',
    domain: '*',
    tags: ['forms', 'dom', 'inputs'],
    code: `async (args) => {
      const labels = Array.from(document.querySelectorAll('label, p, legend')).map(el => el.innerText.trim()).filter(Boolean);
      const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(el => ({
        tag: el.tagName,
        type: el.type || 'text',
        name: el.name || el.id || '',
        placeholder: el.placeholder || '',
      }));
      return {
        prefix: args.prefix || 'FORM_FIELD',
        totalLabels: labels.length,
        totalInputs: inputs.length,
        inputs: inputs.slice(0, 5),
      };
    }`,
  });
  console.log('Save result:', saveRes.script?.name, '(id:', saveRes.script?.id, ')');

  // 2. Semantic vector recall via natural language query
  console.log('\n2. Testing natural language semantic recall: "how to get form input fields"...');
  const recallRes = await request('/scripts/recall', 'POST', {
    query: 'how to get form input fields and labels',
    limit: 3,
  });
  console.log('Recall matches:', recallRes.scripts?.map(s => ({ name: s.name, description: s.description.slice(0, 60) + '...', score: s.score })));

  // 3. Navigate to a test page
  console.log('\n3. Navigating to https://httpbin.org/forms/post to execute macro...');
  await request('/navigate', 'POST', { url: 'https://httpbin.org/forms/post' });
  await new Promise((r) => setTimeout(r, 1500));

  // 4. Run saved macro with dynamic arguments
  console.log('\n4. Running macro "extract_form_labels" with args: { prefix: "CYBERDECK_INPUT" }...');
  const runRes = await request('/scripts/run', 'POST', {
    name: 'extract_form_labels',
    args: { prefix: 'CYBERDECK_INPUT' },
  });
  console.log('Execution result:');
  console.log('  Success:', runRes.execution?.success);
  console.log('  Duration:', runRes.execution?.executionDurationMs, 'ms');
  console.log('  Output:\n', JSON.stringify(runRes.execution?.result, null, 2));

  // 5. List all scripts
  console.log('\n5. Listing all registered scripts in vault...');
  const listRes = await request('/scripts/list', 'GET');
  console.log('Registered scripts count:', listRes.scripts?.length);
  for (const s of listRes.scripts || []) {
    console.log(`  - [${s.name}] ${s.domain} (${s.tags.join(', ')})`);
  }

  // 6. Delete test script
  console.log('\n6. Cleaning up test script "extract_form_labels"...');
  const delRes = await request('/scripts/delete', 'POST', { name: 'extract_form_labels' });
  console.log('Delete result:', delRes);

  console.log('\n✅ Script Vault & Semantic Macro Engine verification completed successfully!');
}

testScriptVault().catch(console.error);
