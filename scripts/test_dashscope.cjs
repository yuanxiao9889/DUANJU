const https = require('https');

// Configuration
// 如果环境变量 DASHSCOPE_API_KEY 未设置，则使用提供的默认 API Key
const API_KEY = process.env.DASHSCOPE_API_KEY || 'sk-5a2028944a174398bdaa3a8488660d97';
const MODEL = 'qwen-turbo';

async function testDashScope() {
    console.log('Testing Alibaba DashScope API...');
    console.log(`Model: ${MODEL}`);
    console.log(`Key: ${API_KEY.slice(0, 8)}...`);

    const requestData = {
        model: MODEL,
        input: {
            prompt: '你好，请回复“测试成功”'
        },
        parameters: {
            result_format: 'message'
        }
    };
    
    const payload = JSON.stringify(requestData);

    const options = {
        hostname: 'dashscope.aliyuncs.com',
        path: '/api/v1/services/aigc/text-generation/generation',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                const status = res.statusCode;
                console.log(`\nStatus Code: ${status}`);
                
                try {
                    const result = JSON.parse(data);
                    
                    if (status === 200 && result.output && result.output.choices) {
                        const content = result.output.choices[0].message.content;
                        console.log('✅ Success!');
                        console.log(`Response: ${content}`);
                        resolve(true);
                    } else {
                        console.log('❌ Failed!');
                        if (result.code) console.log(`Error Code: ${result.code}`);
                        if (result.message) console.log(`Message: ${result.message}`);
                        console.log('Raw Response:', JSON.stringify(result, null, 2));
                        resolve(false);
                    }
                } catch (e) {
                    console.log('❌ Failed to parse response');
                    console.log('Raw Response:', data);
                    resolve(false);
                }
            });
        });

        req.on('error', (e) => {
            console.error(`❌ Network Error: ${e.message}`);
            resolve(false);
        });

        req.write(payload);
        req.end();
    });
}

testDashScope();
