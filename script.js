document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const fileInput = document.getElementById('csvFileInput');
    const columnSelectorContainer = document.getElementById('columnSelectorContainer');
    const columnSelector = document.getElementById('columnSelector');
    const processButton = document.getElementById('processButton');
    const statusDiv = document.getElementById('status');
    const resultsContainer = document.getElementById('resultsContainer');
    const resultsDiv = document.getElementById('results');
    const downloadButton = document.getElementById('downloadButton');

    // App State
    let knowledgeBase = null;
    let fuse = null;
    let parsedData = [];
    let headers = [];
    let normalizedResults = [];

    // --- INITIALIZATION ---
    async function initialize() {
        showStatus('Loading AI knowledge base...');
        try {
            const response = await fetch('data/knowledge_base.json');
            if (!response.ok) throw new Error('Network response was not ok');
            knowledgeBase = await response.json();

            // Initialize Fuse.js for fuzzy searching
            const options = {
                includeScore: true,
                threshold: 0.4, // Adjust this for stricter/looser matching
            };
            fuse = new Fuse(knowledgeBase.allKnownVariants, options);
            
            showStatus('Ready to process files. Please upload a CSV.', false);
        } catch (error) {
            showStatus(`Error loading knowledge base: ${error.message}. Please refresh.`, true);
            console.error('Failed to load knowledge base:', error);
        }
    }

    // --- NORMALIZATION LOGIC (The "AI" part) ---
    function cleanName(name) {
        if (typeof name !== 'string' || !name) return '';
        return name
            .toLowerCase()
            .replace(/[.,&()]/g, '') // Remove common punctuation
            .replace(/\b(inc|corp|llc|lp|co|ltd|group|financial|bank|national association|na|co)\b/g, '') // Remove common suffixes
            .replace(/\s+/g, ' ') // Collapse multiple spaces
            .trim();
    }

    function standardizeName(inputName) {
        if (!inputName) return 'UNKNOWN';

        const cleaned = cleanName(inputName);
        if (!cleaned) return 'UNKNOWN';

        // 1. Exact Match on cleaned variants
        if (knowledgeBase.variants[cleaned]) {
            return knowledgeBase.variants[cleaned];
        }

        // 2. Fuzzy Match using Fuse.js
        const fuzzyResults = fuse.search(cleaned);
        if (fuzzyResults.length > 0 && fuzzyResults[0].score < 0.35) { // Confidence threshold
            const bestMatchVariant = fuzzyResults[0].item;
            return knowledgeBase.variants[bestMatchVariant];
        }
        
        return 'UNKNOWN';
    }

    // --- FILE PROCESSING ---
    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        showStatus(`Parsing ${file.name}...`);
        resultsContainer.style.display = 'none';
        
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                parsedData = results.data;
                headers = results.meta.fields;
                
                // Populate column selector
                columnSelector.innerHTML = '';
                headers.forEach(header => {
                    const option = document.createElement('option');
                    option.value = header;
                    option.textContent = header;
                    columnSelector.appendChild(option);
                });

                columnSelectorContainer.style.display = 'block';
                showStatus(`Parsed ${parsedData.length} rows. Please select the column with firm names and click Normalize.`, false);
            },
            error: (error) => {
                showStatus(`Error parsing CSV: ${error.message}`, true);
            }
        });
    });

    processButton.addEventListener('click', () => {
        const selectedColumn = columnSelector.value;
        if (!selectedColumn || parsedData.length === 0) {
            showStatus('Invalid column or no data to process.', true);
            return;
        }

        processData(selectedColumn);
    });

    function processData(column) {
        processButton.disabled = true;
        showStatus('Starting normalization process...');
        normalizedResults = [];
        let processedCount = 0;
        const totalRows = parsedData.length;

        function processChunk() {
            const chunkSize = 1000; // Process 1000 rows at a time to prevent browser freeze
            const end = Math.min(processedCount + chunkSize, totalRows);
            
            for (let i = processedCount; i < end; i++) {
                const row = parsedData[i];
                const originalName = row[column];
                const standardized = standardizeName(originalName);
                normalizedResults.push({
                    'Input Firm Name': originalName,
                    'Standardized Firm Name': standardized
                });
            }

            processedCount = end;
            showStatus(`Processing... ${processedCount} of ${totalRows} rows completed.`);

            if (processedCount < totalRows) {
                // Yield to the browser's event loop before processing next chunk
                setTimeout(processChunk, 0);
            } else {
                showStatus(`Normalization complete! ${totalRows} rows processed.`, false);
                processButton.disabled = false;
                displayResults();
            }
        }
        
        processChunk();
    }

    // --- UI and DISPLAY ---
    function showStatus(message, isError = false) {
        statusDiv.style.display = 'block';
        statusDiv.textContent = message;
        statusDiv.style.color = isError ? '#c62828' : '#1a237e';
        statusDiv.style.backgroundColor = isError ? '#ffcdd2' : '#e8eaf6';
    }

    function displayResults() {
        // Group results by standardized name
        const grouped = normalizedResults.reduce((acc, curr) => {
            const key = curr['Standardized Firm Name'];
            if (!acc[key]) {
                acc[key] = [];
            }
            // Avoid duplicates in the view
            if (!acc[key].includes(curr['Input Firm Name'])) {
                acc[key].push(curr['Input Firm Name']);
            }
            return acc;
        }, {});

        resultsDiv.innerHTML = ''; // Clear previous results
        
        // Sort keys alphabetically, with UNKNOWN last
        const sortedKeys = Object.keys(grouped).sort((a, b) => {
            if (a === 'UNKNOWN') return 1;
            if (b === 'UNKNOWN') return -1;
            return a.localeCompare(b);
        });

        for (const key of sortedKeys) {
            const variants = grouped[key];
            const details = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = `${key} (${variants.length} variants found)`;
            
            const variantListContainer = document.createElement('div');
            const variantList = document.createElement('ul');
            variants.slice(0, 100).forEach(variant => { // Show max 100 variants to keep UI fast
                const li = document.createElement('li');
                li.textContent = variant;
                variantList.appendChild(li);
            });
             if (variants.length > 100) {
                const li = document.createElement('li');
                li.textContent = `...and ${variants.length - 100} more.`;
                variantList.appendChild(li);
            }

            variantListContainer.appendChild(variantList);
            details.appendChild(summary);
            details.appendChild(variantListContainer);
            resultsDiv.appendChild(details);
        }

        resultsContainer.style.display = 'block';
    }

    // --- DOWNLOAD FUNCTIONALITY ---
    downloadButton.addEventListener('click', () => {
        if (normalizedResults.length === 0) {
            alert('No results to download.');
            return;
        }
        const csvContent = Papa.unparse(normalizedResults);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'normalized_firms.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // --- START THE APP ---
    initialize();
});