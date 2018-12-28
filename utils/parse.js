
var _ = require('lodash');
var xpath = require('xpath')
var select = xpath.useNamespaces({ h: 'http://www.w3.org/1999/xhtml' })
var dom = require('xmldom').DOMParser
var fs = require('fs')

function parseEuro(str) {
  var data = str
  .replace(/\u00A0/g, '')
  .replace(/€/g, '')
  .replace(/ /g, '')
  .replace(/\n/g, '')
  .replace(/\t/g, '')
  return isNumeric(data) ? _.parseInt(data): 0;
}

function isNumeric(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

module.exports.euro = parseEuro


module.exports.result = function parseResult(html, year, callback) {
  var doc = new dom().parseFromString(html.replace(/(\n|\t)/g, ''))
  var result = {
    declarant1: { },
    declarant2: { }
  }

  var mappingDeclarant = {
    nom: 'Nom',
    nomNaissance : 'Nom de naissance',
    prenoms: 'Prénom(s)',
    dateNaissance : 'Date de naissance'
  };

  var compactedDeclarantMapping = _.map(mappingDeclarant, function (val, key) {
    var obj = _.isString(val) ? { src: val } : val;
    return _.assign(obj, { dest: key });
  });

  var declarantMappingBySrc = _.indexBy(compactedDeclarantMapping, 'src');

  function getImpot(value) {
    if(value.trim() === "Non imposable") {
      return null
    }
    return parseEuro(value)
  }

  var mapping = {
    dateRecouvrement: 'Date de mise en recouvrement de l\'avis d\'impôt',
    dateEtablissement: 'Date d\'établissement',
    nombreParts: { src: 'Nombre de part(s)', fn: parseFloat },
    situationFamille: 'Situation de famille',
    nombrePersonnesCharge: { src: 'Nombre de personne(s) à charge', fn: _.parseInt },
    revenuBrutGlobal: { src: 'Revenu brut global', fn: parseEuro },
    revenuImposable: { src: 'Revenu imposable', fn: parseEuro },
    impotRevenuNetAvantCorrections: { src: 'Impôt sur le revenu net avant corrections', fn: getImpot },
    montantImpot: { src: 'Montant de l\'impôt', fn: getImpot },
    revenuFiscalReference: { src: 'Revenu fiscal de référence', fn: parseEuro }
  };

  var compactedMapping = _.map(mapping, function (val, key) {
    var obj = _.isString(val) ? { src: val } : val;
    return _.assign(obj, { dest: key });
  });

  var mappingBySrc = _.indexBy(compactedMapping, 'src');

  if (select('//*[@id="nonTrouve"]', doc).length) {
    return callback(new Error('Invalid credentials'));
  }

  var docRow = select('//*[@id="principal"]//h:table//h:tr', doc)
  docRow.forEach(function(line) {
    var cells = line.getElementsByTagName('td')
    var rowHeading = cells[0].firstChild
    if (rowHeading && rowHeading.data in declarantMappingBySrc) {
      var mappingEntry = declarantMappingBySrc[rowHeading];
      if (mappingEntry.fn) {
        result = mappingEntry.fn(line, result)
      } else {
        if (cells[1].firstChild) {
          result.declarant1[mappingEntry.dest] = cells[1].firstChild.data
        }
        var data;
        if (cells[2].firstChild) {
          data = cells[2].firstChild.data
        }
        result.declarant2[mappingEntry.dest] = data || ''
      }


    } else if (cells.length === 2 && rowHeading in mappingBySrc) {
      var mappingEntry = mappingBySrc[rowHeading];
      if (cells[1].firstChild) {
        if (mappingEntry.fn) {
          result[mappingEntry.dest] = mappingEntry.fn(cells[1].firstChild.data);
        } else {
          result[mappingEntry.dest] = cells[1].firstChild.data
        }
      }
    }
  })

  result.foyerFiscal = {
    annee : year
  }

  // on teste si l'adresse est composé de 3 TR (complement, adresse, codepostal + ville)
  var has3TrNode = docRow[7].getElementsByTagName('td')[1];
  var has3Tr = (has3TrNode && has3TrNode.firstChild);

  // en fonction du nombre de tr on assossie la bonne variable
  var foyerFiscalRows = {
        complement: has3Tr?5:7,
        adresse:has3Tr?6:5,
        ville:has3Tr?7:6
      };


  Object.keys(foyerFiscalRows).forEach(function (k) {
    var n = foyerFiscalRows[k]
    var node = docRow[n].getElementsByTagName('td')[1]
    result.foyerFiscal[k] = (node && node.firstChild) ? node.firstChild.data : '';
  })


  var nodeAnnee = select('//*[@class="titre_affiche_avis"]//h:span', doc)
  if (nodeAnnee.length > 0) {
    var titleAnnee = nodeAnnee[0].firstChild.data;
    var regexp = /(\d{4})/g;

    result.anneeImpots = regexp.exec(titleAnnee)[0];
    result.anneeRevenus = regexp.exec(titleAnnee)[0];
  }
  if(!result.declarant1.nom) {
    return callback(new Error("Parsing error"))
  }
  callback(null, result)

}
