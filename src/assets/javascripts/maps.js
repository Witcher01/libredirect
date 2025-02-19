"use strict"

window.browser = window.browser || window.chrome
import utils from "./utils.js"

const targets = /^https?:\/{2}(((www|maps)\.)?(google\.).*(\/maps)|maps\.(google\.).*)/

const frontends = new Array("facil")
const protocols = new Array("normal", "tor", "i2p", "loki")

let redirects = {}

for (let i = 0; i < frontends.length; i++) {
	redirects[frontends[i]] = {}
	for (let x = 0; x < protocols.length; x++) {
		redirects[frontends[i]][protocols[x]] = []
	}
}

redirects.osm = {}
redirects.osm.normal = ["https://www.openstreetmap.org"]

function setRedirects(val) {
	return new Promise(resolve =>
		browser.storage.local.get(["cloudflareBlackList", "offlineBlackList"], r => {
			redirects.facil = val
			facilNormalRedirectsChecks = [...redirects.facil.normal]
			for (const instance of [...r.cloudflareBlackList, ...r.offlineBlackList]) {
				const a = facilNormalRedirectsChecks.indexOf(instance)
				if (a > -1) facilNormalRedirectsChecks.splice(a, 1)
			}
			browser.storage.local.set(
				{
					mapsRedirects: redirects,
					facilNormalRedirectsChecks,
					facilTorRedirectsChecks: [...redirects.facil.tor],
					facilI2pRedirectsChecks: [...redirects.facil.i2p],
					facilLokiRedirectsChecks: [...redirects.facil.loki],
				},
				() => resolve()
			)
		})
	)
}

let disableMaps,
	mapsFrontend,
	protocol,
	protocolFallback,
	facilNormalRedirectsChecks,
	facilNormalCustomRedirects,
	facilTorRedirectsChecks,
	facilTorCustomRedirects,
	facilI2pRedirectsChecks,
	facilI2pCustomRedirects,
	facilLokiRedirectsChecks,
	facilLokiCustomRedirects

function init() {
	browser.storage.local.get(
		[
			"disableMaps",
			"mapsFrontend",
			"protocol",
			"protocolFallback",
			"facilNormalRedirectsChecks",
			"facilNormalCustomRedirects",
			"facilTorRedirectsChecks",
			"facilTorCustomRedirects",
			"facilI2pRedirectsChecks",
			"facilI2pCustomRedirects",
			"facilLokiRedirectsChecks",
			"facilLokiCustomRedirects",
		],
		r => {
			disableMaps = r.disableMaps
			mapsFrontend = r.mapsFrontend
			protocol = r.protocol
			protocolFallback = r.protocolFallback
			facilNormalRedirectsChecks = r.facilNormalRedirectsChecks
			facilNormalCustomRedirects = r.facilNormalCustomRedirects
			facilTorRedirectsChecks = r.facilTorRedirectsChecks
			facilTorCustomRedirects = r.facilTorCustomRedirects
			facilI2pRedirectsChecks = r.facilI2pRedirectsChecks
			facilI2pCustomRedirects = r.facilI2pCustomRedirects
			facilLokiRedirectsChecks = r.facilLokiRedirectsChecks
			facilLokiCustomRedirects = r.facilLokiCustomRedirects
		}
	)
}

init()
browser.storage.onChanged.addListener(init)

function redirect(url, initiator) {
	if (disableMaps) return
	if (initiator && initiator.host === "earth.google.com") return
	if (!url.href.match(targets)) return
	const mapCentreRegex = /@(-?\d[0-9.]*),(-?\d[0-9.]*),(\d{1,2})[.z]/
	const dataLatLngRegex = /!3d(-?[0-9]{1,}.[0-9]{1,})!4d(-?[0-9]{1,}.[0-9]{1,})/
	const placeRegex = /\/place\/(.*)\//
	const travelModes = {
		driving: "fossgis_osrm_car",
		walking: "fossgis_osrm_foot",
		bicycling: "fossgis_osrm_bike",
		transit: "fossgis_osrm_car", // not implemented on OSM, default to car.
	}
	const travelModesFacil = {
		driving: "car",
		walking: "pedestrian",
		bicycling: "bicycle",
		transit: "car", // not implemented on Facil, default to car.
	}
	const osmLayers = {
		none: "S",
		transit: "T",
		traffic: "S", // not implemented on OSM, default to standard.
		bicycling: "C",
	}
	function addressToLatLng(address) {
		const xmlhttp = new XMLHttpRequest()
		xmlhttp.open("GET", `https://nominatim.openstreetmap.org/search/${address}?format=json&limit=1`, false)
		xmlhttp.send()
		if (xmlhttp.status === 200) {
			const json = JSON.parse(xmlhttp.responseText)[0]
			if (json) {
				console.log("json", json)
				return [`${json.lat},${json.lon}`, `${json.boundingbox[2]},${json.boundingbox[1]},${json.boundingbox[3]},${json.boundingbox[0]}`]
			}
		}
		console.info("Error: Status is " + xmlhttp.status)
	}

	let instancesList
	switch (mapsFrontend) {
		case "osm":
			instancesList = [...redirects.osm.normal]
			break
		case "facil":
			switch (protocol) {
				case "loki":
					instancesList = [...facilLokiRedirectsChecks, ...facilLokiCustomRedirects]
					break
				case "i2p":
					instancesList = [...facilI2pRedirectsChecks, ...facilI2pCustomRedirects]
					break
				case "tor":
					instancesList = [...facilTorRedirectsChecks, ...facilTorCustomRedirects]
			}
			if ((instancesList == "" && protocolFallback) || protocol == "normal") {
				instancesList = [...facilNormalRedirectsChecks, ...facilNormalCustomRedirects]
			}
	}
	const randomInstance = utils.getRandomInstance(instancesList)

	let mapCentre = "#"
	let prefs = {}

	if (url.pathname.match(mapCentreRegex)) {
		// Set map centre if present
		var [, lat, lon, zoom] = url.pathname.match(mapCentreRegex)
	} else if (url.searchParams.has("center")) {
		var [lat, lon] = url.searchParams.get("center").split(",")
		var zoom = url.searchParams.get("zoom") ?? "17"
	}

	if (lat && lon && zoom) {
		if (mapsFrontend == "osm") mapCentre = `#map=${zoom}/${lat}/${lon}`
		if (mapsFrontend == "facil") mapCentre = `#${zoom}/${lat}/${lon}`
	}

	if (url.searchParams.get("layer")) prefs.layers = osmLayers[url.searchParams.get("layer")]

	if (url.pathname.includes("/embed")) {
		// Handle Google Maps Embed API
		// https://www.google.com/maps/embed/v1/place?key=AIzaSyD4iE2xVSpkLLOXoyqT-RuPwURN3ddScAI&q=Eiffel+Tower,Paris+France
		console.log("embed life")

		let query = ""
		if (url.searchParams.has("q")) query = url.searchParams.get("q")
		else if (url.searchParams.has("query")) query = url.searchParams.has("query")
		else if (url.searchParams.has("pb"))
			try {
				query = url.searchParams.get("pb").split(/!2s(.*?)!/)[1]
			} catch (error) {
				console.error(error)
			} // Unable to find map marker in URL.

		let [coords, boundingbox] = addressToLatLng(query)
		prefs.bbox = boundingbox
		prefs.marker = coords
		prefs.layer = "mapnik"
		let prefsEncoded = new URLSearchParams(prefs).toString()
		if (mapsFrontend == "osm") return `${randomInstance}/export/embed.html?${prefsEncoded}`
		if (mapsFrontend == "facil") return `${randomInstance}/#q=${query}`
	} else if (url.pathname.includes("/dir")) {
		// Handle Google Maps Directions
		// https://www.google.com/maps/dir/?api=1&origin=Space+Needle+Seattle+WA&destination=Pike+Place+Market+Seattle+WA&travelmode=bicycling

		let travMod = url.searchParams.get("travelmode")
		if (url.searchParams.has("travelmode")) prefs.engine = travelModes[travMod]

		let orgVal = url.searchParams.get("origin")
		let destVal = url.searchParams.get("destination")

		let org
		addressToLatLng(orgVal, a => (org = a))
		let dest
		addressToLatLng(destVal, a => (dest = a))
		prefs.route = `${org};${dest}`

		let prefsEncoded = new URLSearchParams(prefs).toString()
		if (mapsFrontend == "osm") return `${randomInstance}/directions?${prefsEncoded}${mapCentre}`
		if (mapsFrontend == "facil") return `${randomInstance}/#q=${orgVal}%20to%20${destVal}%20by%20${travelModesFacil[travMod]}`
	} else if (url.pathname.includes("data=") && url.pathname.match(dataLatLngRegex)) {
		// Get marker from data attribute
		// https://www.google.com/maps/place/41%C2%B001'58.2%22N+40%C2%B029'18.2%22E/@41.032833,40.4862063,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0xf64286eaf72fc49d!7e2!8m2!3d41.0328329!4d40.4883948
		console.log("data life")

		let [, mlat, mlon] = url.pathname.match(dataLatLngRegex)

		if (mapsFrontend == "osm") return `${randomInstance}/search?query=${mlat}%2C${mlon}`
		if (mapsFrontend == "facil") return `${randomInstance}/#q=${mlat}%2C${mlon}`
	} else if (url.searchParams.has("ll")) {
		// Get marker from ll param
		// https://maps.google.com/?ll=38.882147,-76.99017
		console.log("ll life")

		const [mlat, mlon] = url.searchParams.get("ll").split(",")

		if (mapsFrontend == "osm") return `${randomInstance}/search?query=${mlat}%2C${mlon}`
		if (mapsFrontend == "facil") return `${randomInstance}/#q=${mlat}%2C${mlon}`
	} else if (url.searchParams.has("viewpoint")) {
		// Get marker from viewpoint param.
		// https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=48.857832,2.295226&heading=-45&pitch=38&fov=80
		console.log("viewpoint life")

		const [mlat, mlon] = url.searchParams.get("viewpoint").split(",")

		if (mapsFrontend == "osm") return `${randomInstance}/search?query=${mlat}%2C${mlon}`
		if (mapsFrontend == "facil") return `${randomInstance}/#q=${mlat}%2C${mlon}`
	} else {
		// Use query as search if present.
		console.log("normal life")

		let query
		if (url.searchParams.has("q")) query = url.searchParams.get("q")
		else if (url.searchParams.has("query")) query = url.searchParams.get("query")
		else if (url.pathname.match(placeRegex)) query = url.pathname.match(placeRegex)[1]

		let prefsEncoded = new URLSearchParams(prefs).toString()
		if (query) {
			if (mapsFrontend == "osm") return `${randomInstance}/search?query="${query}${mapCentre}&${prefsEncoded}`
			if (mapsFrontend == "facil") return `${randomInstance}/${mapCentre}/Mpnk/${query}`
		}
	}

	let prefsEncoded = new URLSearchParams(prefs).toString()
	console.log("mapCentre", mapCentre)
	console.log("prefs", prefs)
	console.log("prefsEncoded", prefsEncoded)
	if (mapsFrontend == "osm") return `${randomInstance}/${mapCentre}&${prefsEncoded}`
	if (mapsFrontend == "facil") return `${randomInstance}/${mapCentre}/Mpnk`
}

function initDefaults() {
	return new Promise(async resolve => {
		fetch("/instances/data.json")
			.then(response => response.text())
			.then(async data => {
				let dataJson = JSON.parse(data)
				for (let i = 0; i < frontends.length; i++) {
					redirects[frontends[i]] = dataJson[frontends[i]]
				}
				browser.storage.local.get(["cloudflareBlackList", "offlineBlackList"], async r => {
					facilNormalRedirectsChecks = [...redirects.facil.normal]
					for (const instance of [...r.cloudflareBlackList, ...r.offlineBlackList]) {
						const a = facilNormalRedirectsChecks.indexOf(instance)
						if (a > -1) facilNormalRedirectsChecks.splice(a, 1)
					}
					browser.storage.local.set(
						{
							disableMaps: false,
							mapsFrontend: "osm",
							mapsRedirects: redirects,
							facilNormalRedirectsChecks,
							facilNormalCustomRedirects: [],

							facilTorRedirectsChecks: [...redirects.facil.tor],
							facilTorCustomRedirects: [],

							facilI2pRedirectsChecks: [...redirects.facil.i2p],
							facilI2pCustomRedirects: [],

							facilLokiRedirectsChecks: [...redirects.facil.loki],
							facilLokiCustomRedirects: [],
						},
						() => resolve()
					)
				})
			})
	})
}

export default {
	setRedirects,
	redirect,
	initDefaults,
}
