// Netzwerk Leopoldinum – Fotos vor dem Hochladen verkleinern (Fotoarchiv, Klassenfotos)
// Spart Speicher und Ladezeit und entfernt nebenbei Metadaten wie den GPS-Standort aus dem Foto.

window.verkleinereBild = async (datei, maxKante = 2400, qualitaet = 0.85) => {
  const bild = await createImageBitmap(datei, { imageOrientation: "from-image" });
  const faktor = Math.min(1, maxKante / Math.max(bild.width, bild.height));
  const breite = Math.round(bild.width * faktor);
  const hoehe = Math.round(bild.height * faktor);
  const canvas = document.createElement("canvas");
  canvas.width = breite;
  canvas.height = hoehe;
  canvas.getContext("2d").drawImage(bild, 0, 0, breite, hoehe);
  bild.close?.();
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", qualitaet));
  if (!blob) throw new Error("Das Foto konnte nicht umgewandelt werden.");
  return blob;
};
