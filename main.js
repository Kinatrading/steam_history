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
	  let totalSpent = 0, totalEarned = 0;

	  for (const trade of trades) {
		const item = summary[trade.name] ??= { bought: [], sold: [] };
		if (trade.acted === "bought") {
		  item.bought.push(trade.price);
		  totalSpent += trade.price;
		}
		if (trade.acted === "sold") {
		  item.sold.push(trade.price);
		  totalEarned += trade.price;
		}
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
		const avgBuy = buys.length ? (buys.reduce((a, b) => a + b, 0) / buys.length) : 0;
		const avgSell = sells.length ? (sells.reduce((a, b) => a + b, 0) / sells.length) : 0;
		const percentProfit = (buys.length > 0) ? (profit / buys.length) / avgBuy * 100 : 0;
		final.push({
		  name,
		  bought: buys.length,
		  sold: sells.length,
		  avgBuy: avgBuy.toFixed(2),
		  avgSell: avgSell.toFixed(2),
		  profit: profit.toFixed(2),
		  percentProfit: percentProfit.toFixed(2)
		});
	  }

	  resultsContainer.innerHTML = `
		<table>
		  <thead>
			<tr>
			  <th>Назва</th>
			  <th>Куплено</th>
			  <th>Продано</th>
			  <th>Сер. ціна купівлі</th>
			  <th>Сер. ціна продажу</th>
			  <th>Прибуток</th>
			  <th>% з однієї</th>
			</tr>
		  </thead>
		  <tbody>
			${final.map(row => `<tr>
			  <td>${row.name}</td>
			  <td>${row.bought}</td>
			  <td>${row.sold}</td>
			  <td>${row.avgBuy}</td>
			  <td>${row.avgSell}</td>
			  <td>${row.profit}</td>
			  <td>${row.percentProfit}</td>
			</tr>`).join('')}
		  </tbody>
		  <tfoot>
			<tr>
			  <td colspan="4"><b>Загалом витрачено:</b> ${totalSpent.toFixed(2)}</td>
			  <td colspan="3"><b>Отримано:</b> ${totalEarned.toFixed(2)}</td>
			</tr>
		  </tfoot>
		</table>
	  `;
	}


  // Основна логіка парсингу — різна для двох кнопок!
  async function fetchTrades(stopAtDate = null, ignoreUID = false) {
    const history = getStoredHistory();
    const processedSet = new Set(history.processed_items || []);
    const allTrades = ignoreUID ? [] : [...history.trades]; // якщо парсимо до дати — починаємо з порожнього!
    let page = 0;
    let stop = false;
    let total429 = 0;

    while (!stop) {
      const start = page * 100;
      const url = `https://steamcommunity.com/market/myhistory/render/?query=&start=${start}&count=100`;

      status.innerText = `🔄 Парсимо сторінку ${page + 1}... (429: ${total429} разів)`;

      try {
        const res = await fetch(url, {
          credentials: "include",
          headers: { Accept: "application/json" }
        });

        if (res.status === 429) {
          total429++;
          status.innerText = `⚠️ 429 Too Many Requests (x${total429}). Чекаю 30 секунд...`;
          await delay(30000);
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
		  const actedOn = row.querySelector(".market_listing_listed_date")?.textContent.trim() || "";

		  if (!ignoreUID && processedSet.has(uid)) {
			stop = true;
			break;
		  }

		  // === Ось ця перевірка тільки по ACTED ON ===
		  if (ignoreUID && stopAtDate && actedOn.includes(stopAtDate)) {
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


		// ОНОВЛЕННЯ ТАБЛИЦІ після кожної сторінки:
		showTable(allTrades);


      } catch (err) {
        status.innerText = `❌ Помилка: ${err.message}`;
        break;
      }

      page++;
      await delay(1500);
    }

    // якщо в режимі ignoreUID — зберігаємо як нову історію, processed_items лишаємо лише нові UID
    if (ignoreUID) {
      const newProcessedSet = new Set();
      // всі унікальні UID, які були зібрані під час цього проходу
      for (const trade of allTrades) {
        const uid = `${trade.id}_${trade.classid}_${trade.instanceid}`;
        newProcessedSet.add(uid);
      }
      saveHistory({ trades: allTrades, processed_items: Array.from(newProcessedSet) });
    } else {
      saveHistory({ trades: allTrades, processed_items: Array.from(processedSet) });
    }

    status.innerText = `✅ Оброблено ${allTrades.length} записів.`;
    return allTrades;
  }

  analyzeBtn.onclick = async () => {
    const trades = await fetchTrades(); // UID перевірка
    showTable(trades);
  };

  loadToDateBtn.onclick = async () => {
    const stopDate = stopDateInput.value.trim();
    const trades = await fetchTrades(stopDate, true); // ігнорувати UID!
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
