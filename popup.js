
document.addEventListener("DOMContentLoaded", () => {
  const analyzeBtn = document.getElementById("analyzeBtn");
  const loadToDateBtn = document.getElementById("loadToDateBtn");
  const resetBtn = document.getElementById("resetBtn");
  const showBtn = document.getElementById("showBtn");
  const stopDateInput = document.getElementById("stopDate");
  const resultsContainer = document.getElementById("results");
  const status = document.getElementById("status");

  function getStoredHistory() {
    try {
      const raw = localStorage.getItem("steam_analyzer_history");
      return JSON.parse(raw) || { trades: [], processed_items: [] };
    } catch {
      return { trades: [], processed_items: [] };
    }
  }

  function saveHistory(history) {
    localStorage.setItem("steam_analyzer_history", JSON.stringify(history));
  }

  function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  function parsePrice(str) {
    return parseFloat(str.replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
  }

  function showTable(trades) {
    if (trades.length === 0) {
      resultsContainer.innerHTML = "<i>Даних нема.</i>";
      return;
    }

    const summary = {};
    for (const trade of trades) {
      const item = summary[trade.name] ??= { bought: [], sold: [] };
      item[trade.acted].push(trade.price);
    }

    const final = [];
    for (const [name, data] of Object.entries(summary)) {
      const buys = data.bought.sort((a, b) => a - b);
      const sells = data.sold.sort((a, b) => b - a);
      const count = Math.min(buys.length, sells.length);
      let profit = 0;
      for (let i = 0; i < count; i++) {
        profit += sells[i] - buys[i];
      }
      final.push({
        name,
        bought: buys.length,
        sold: sells.length,
        profit: profit.toFixed(2)
      });
    }

    resultsContainer.innerHTML = `
      <table>
        <thead><tr><th>Назва</th><th>Куплено</th><th>Продано</th><th>Прибуток</th></tr></thead>
        <tbody>
          ${final.map(row => `<tr>
            <td>${row.name}</td>
            <td>${row.bought}</td>
            <td>${row.sold}</td>
            <td>${row.profit}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
  }

async function fetchTrades(stopAtDate = null, ignoreUID = false) {
  const history = getStoredHistory();
  const processedSet = new Set(history.processed_items || []);
  const allTrades = [...history.trades];
  let page = 0;
  let stop = false;
  let total429 = 0;

  while (!stop) {
    const start = page * 10;
    const url = `https://steamcommunity.com/market/myhistory/render/?query=&start=${start}&count=10`;

    status.innerText = `🔄 Парсимо сторінку ${page + 1}... (429: ${total429} разів)`;

    try {
      const res = await fetch(url, {
        credentials: "include",
        headers: { Accept: "application/json" }
      });

      if (res.status === 429) {
        total429++;
        status.innerText = `⚠️ 429 Too Many Requests (x${total429}). Чекаю 60 секунд...`;
        await delay(60000);
        continue;
      }

      const data = await res.json();
      if (!data || !data.success) {
        status.innerText = `⚠️ Невдала відповідь на сторінці ${page + 1}. Пропускаю.`;
        page++;
        continue;
      }

      const parser = new DOMParser();
      const htmlDoc = parser.parseFromString(data.results_html, "text/html");
      const rows = htmlDoc.querySelectorAll(".market_recent_listing_row");

      for (const row of rows) {
        const id = row.getAttribute("id")?.match(/listing_(\d+)/)?.[1] || "";
        const classid = row.dataset.classid || "";
        const instanceid = row.dataset.instanceid || "";
        const uid = `${id}_${classid}_${instanceid}`;
        const rawText = row.innerText;

        // 🟥 якщо не в режимі ignoreUID → зупиняємось по UID
        if (!ignoreUID && processedSet.has(uid)) {
          stop = true;
          break;
        }

        // 🟥 якщо задано дату → зупиняємось по ній (включно)
        if (stopAtDate && rawText.includes(stopAtDate)) {
          // додаємо і зупиняємось
          const name = row.querySelector(".market_listing_item_name")?.textContent.trim();
          const priceStr = row.querySelector(".market_listing_price")?.textContent.trim();
          const symbol = row.querySelector(".market_listing_gainorloss")?.textContent.trim();
          const acted = symbol === "+" ? "bought" : symbol === "−" || symbol === "-" ? "sold" : "unknown";
          const price = parsePrice(priceStr);
          if (name && acted !== "unknown" && price > 0) {
            allTrades.push({ name, acted, price });
          }
          stop = true;
          break;
        }

        processedSet.add(uid);

        const name = row.querySelector(".market_listing_item_name")?.textContent.trim();
        const priceStr = row.querySelector(".market_listing_price")?.textContent.trim();
        const symbol = row.querySelector(".market_listing_gainorloss")?.textContent.trim();
        const acted = symbol === "+" ? "bought" : symbol === "−" || symbol === "-" ? "sold" : "unknown";
        const price = parsePrice(priceStr);

        if (name && acted !== "unknown" && price > 0) {
          allTrades.push({ name, acted, price });
        }
      }

    } catch (err) {
      status.innerText = `❌ Помилка: ${err.message}`;
      break;
    }

    page++;
    await delay(1500);
  }

  saveHistory({ trades: allTrades, processed_items: [...processedSet] });
  status.innerText = `✅ Оброблено ${allTrades.length} записів.`;
  return allTrades;
}


  analyzeBtn.onclick = async () => {
    const trades = await fetchTrades();
    showTable(trades);
  };

  loadToDateBtn.onclick = async () => {
    const stopDate = stopDateInput.value.trim();
    const trades = await fetchTrades(stopDate);
    showTable(trades);
  };

  resetBtn.onclick = () => {
    localStorage.removeItem("steam_analyzer_history");
    resultsContainer.innerHTML = "";
    status.innerText = "🧹 Історію очищено.";
  };

  showBtn.onclick = () => {
    const history = getStoredHistory();
    showTable(history.trades || []);
    status.innerText = `📊 Показано ${history.trades?.length || 0} записів.`;
  };
});
