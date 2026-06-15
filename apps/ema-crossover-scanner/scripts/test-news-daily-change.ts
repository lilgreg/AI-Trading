import { fetchEmaCrossNews } from "../lib/news";
import { loadSnapshot } from "../lib/scan-cache";

async function main() {
  const snapshot = await loadSnapshot();
  if (!snapshot?.results?.length) {
    console.log("No cache snapshot");
    return;
  }

  const headlines = await fetchEmaCrossNews(snapshot.results);
  console.log(`Headlines: ${headlines.length}`);
  for (const item of headlines.slice(0, 5)) {
    console.log(
      JSON.stringify({
        symbol: item.symbol,
        displayTicker: item.displayTicker,
        dailyChange: item.dailyChange,
        headline: item.headline.slice(0, 60),
      }),
    );
  }

  const withDaily = headlines.filter((h) => h.dailyChange != null).length;
  console.log(`\nWith dailyChange: ${withDaily}/${headlines.length}`);
}

main().catch(console.error);
