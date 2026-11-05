// Validate the editable JSON before either layout creates links from it.
export function validateCatalog(data, baseURL) {
    if (!data || Array.isArray(data) || typeof data !== 'object') {
        throw new Error('The game catalog must contain named collections.');
    }
    function checkURL(value, allowRelative = false) {
        if (typeof value !== 'string' || !value.trim()) throw new Error('Missing game URL.');
        const url = allowRelative ? new URL(value, baseURL) : new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL protocol.');
    }
    function checkItems(items) {
        if (!Array.isArray(items)) throw new Error('A collection must be an array.');
        for (const item of items) {
            if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 1) {
                throw new Error('Each catalog entry must have one name.');
            }
            const [name, value] = Object.entries(item)[0];
            if (!name.trim()) throw new Error('A game or group needs a name.');
            if (Array.isArray(value)) checkItems(value);
            else if (typeof value === 'string') checkURL(value);
            else {
                if (!value || typeof value !== 'object') throw new Error('Invalid game entry.');
                checkURL(value.url);
                if (value.thumb) checkURL(value.thumb, true);
            }
        }
    }
    for (const [name, items] of Object.entries(data)) {
        if (!name.trim()) throw new Error('A collection needs a name.');
        checkItems(items);
    }
    return data;
}
