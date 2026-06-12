const localDictionary = {
    "hello": { es: "Hola", ja: "こんにちは", fr: "Bonjour", de: "Hallo" },
    "how are you?": { es: "¿Cómo estás?", ja: "お元気ですか？", fr: "Comment ça va?", de: "Wie geht es dir?" },
    "how are you": { es: "¿Cómo estás?", ja: "お元気ですか？", fr: "Comment ça va?", de: "Wie geht es dir?" },
    "good morning": { es: "Buenos días", ja: "おはようございます", fr: "Bonjour", de: "Guten morgen" },
    "thank you": { es: "Gracias", ja: "ありがとう", fr: "Merci", de: "Danke" },
    "yes": { es: "Sí", ja: "はい", fr: "Oui", de: "Ja" },
    "no": { es: "No", ja: "いいえ", fr: "Non", de: "Nein" },
    "goodbye": { es: "Adiós", ja: "さようなら", fr: "Au revoir", de: "Auf wiedersehen" }
};

async function translateText(text, fromLang, toLang) {
    if (!text.trim()) return '';
    if (fromLang === toLang) return text;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(text)}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await res.json();
        if (data && data[0]) {
            const translatedSegments = data[0].map(item => item[0]);
            return translatedSegments.join('');
        }
        throw new Error("Translation API responded with unexpected format");
    } catch (err) {
        console.warn(`Translation failed from ${fromLang} to ${toLang}. Using offline dictionary:`, err.message);
        
        const clean = text.toLowerCase().trim().replace(/[?.!,]/g, '');
        if (localDictionary[clean] && localDictionary[clean][toLang]) {
            return localDictionary[clean][toLang];
        }
        return `[${toLang.toUpperCase()}] ${text}`;
    }
}

module.exports = {
    translateText
};
