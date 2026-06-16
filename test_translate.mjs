const query = process.argv[2] || 'преимущества typescript';
const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(query)}&langpair=ru|en`;
const res = await fetch(url);
const data = await res.json();
console.log(data.responseData.translatedText);
