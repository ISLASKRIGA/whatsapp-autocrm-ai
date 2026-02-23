const fs = require('fs');

function fixAccents(text) {
    const replacements = {
        'Ã¡': 'á',
        'Ã©': 'é',
        'Ã­': 'í',
        'Ã³': 'ó',
        'Ãº': 'ú',
        'Ã±': 'ñ',
        'Ã ': 'Á',
        'Ã‰': 'É',
        'Ã ': 'Í',
        'Ã“': 'Ó',
        'Ãš': 'Ú',
        'Ã‘': 'Ñ',
        'Â¿': '¿',
        'Â¡': '¡'
    };

    let fixed = text;
    for (const [bad, good] of Object.entries(replacements)) {
        fixed = fixed.split(bad).join(good);
    }
    return fixed;
}

const files = ['public/index.html', 'public/app.js', 'server.js'];
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let fixed = fixAccents(content);
    if (content !== fixed) {
        fs.writeFileSync(file, fixed, 'utf8');
        console.log(`Fixed ${file}`);
    } else {
        console.log(`No changes in ${file}`);
    }
});
