(() => {
	const saved = localStorage.getItem("vh-theme");
	const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	const theme = saved || (prefersDark ? "dark" : "light");
	if (theme === "dark") {
		document.documentElement.classList.add("dark");
	}
})();
