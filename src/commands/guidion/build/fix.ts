import * as fs from 'fs';

import { SfdxCommand } from '@salesforce/command';
import { Messages, SfdxError, SfdxProject, SfdxProjectJson} from '@salesforce/core';
import { AnyJson, JsonArray, JsonMap } from '@salesforce/ts-types';

import mergedirs from 'merge-dirs'
import { filter } from 'underscore';

const find = require('find');
const libxml = require('libxmljs');

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('guidion', 'org');

export default class Fix extends SfdxCommand {

  public static description = messages.getMessage('commandDescription');
  public static examples = [
    `$ sfdx guidion:build:fix`
  ];
  protected static flagsConfig = {};
  protected static requiresUsername = true;
  protected static supportsDevhubUsername = true;
  protected static requiresProject = true;

  public async run(): Promise<AnyJson> {

    const project = await SfdxProject.resolve();
    const basePath = project.getPath();

    if (!project) {
      throw new SfdxError(messages.getMessage('errorNoSfdxProject'));
    }

    this.ux.log('\n              ________      .__    .___.__\n             /  _____/ __ __|__| __| _/|__| ____   ____  \n            /   \\  ___|  |  \\  |/ __ | |  |/  _ \\ /    \\ \n            \\    \\_\\  \\  |  /  / /_/ | |  (  <_> )   |  \\\n             \\______  /____/|__\\____ | |__|\\____/|___|  /\n                    \\/              \\/                \\/\n    ');

    this.ux.log(`Project path ${basePath}`);

    await this.mergeDirs(basePath);

    await this.mergeCustomLabels(basePath);

    return {};

  }

  public async deleteFolderRecursive(path) {
    if (fs.existsSync(path)) {
      fs.readdirSync(path).forEach((file, index) => {
        const curPath = path + '/' + file;
        if (fs.lstatSync(curPath).isDirectory()) {
          this.deleteFolderRecursive(curPath);
        } else {
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(path);
    }
  }

  public async mergeDirs(basePath: string) {
    const project = await SfdxProject.resolve();
    const projectInfo: SfdxProjectJson = await project.retrieveSfdxProjectJson();
    const packages = projectInfo.get('packageDirectories');
    const defaultFolderPath = basePath + '/default';
    const defaultObjectFolderPath = defaultFolderPath + '/objects';
    const defaultLabelsFolderPath = defaultFolderPath + '/labels';

    this.ux.log('Clearing default package...');

    try {
      this.deleteFolderRecursive(defaultFolderPath);
    } catch (ex) {
      this.ux.log(ex);
    }

    this.ux.log('Creating directories...');

    fs.mkdirSync(defaultFolderPath);
    fs.mkdirSync(defaultObjectFolderPath);
    fs.mkdirSync(defaultLabelsFolderPath);

    this.ux.log('Merging directories...');
    this.ux.log('Packages:' + packages);

    for (let dxPackage of packages as JsonArray) {
      dxPackage = dxPackage as JsonMap;

      if (dxPackage.path === 'default') {
        continue;
      }

      const packageCanPath = basePath + '/' + dxPackage.path;

      try {

        const objectDirectories: string[] = this.resolveObjectFolder(packageCanPath);
        if (objectDirectories.length > 0) {
          const objectFolderInThePackage = objectDirectories[0];
          this.ux.log(`dxPackage() merging ${objectFolderInThePackage} to ${defaultObjectFolderPath}`);
          mergedirs(objectFolderInThePackage, defaultObjectFolderPath, 'override');
        }

      } catch (err) {
        this.ux.log(err);
      }

    }

  }

  public resolveObjectFolder(packageDirectory: string): string[] {
    const objectDirectories = filter(find.dirSync('objects', packageDirectory), dir => {
      return this.isValidSObjectFolder(dir);
    }) as string[];
    return objectDirectories;
  }

  public mergeCustomLabels(projectPath: string) {

    this.ux.log('Merging custom labels');

    const customLabelFinalPath = `${projectPath}/default/labels/CustomLabels.labels-meta.xml`;

    try {
      fs.unlinkSync(customLabelFinalPath);
    } catch (ex) {

    }

    find.file(/CustomLabels.labels-meta.xml/g, projectPath, files => {

      this.ux.log(`Found ${files.length} Custom label files to merge.`);
      this.ux.logJson(files);

      const customLabelMergeDocument = new libxml.Document()
        .node('CustomLabels');

      customLabelMergeDocument.attr({xmlns: 'http://soap.sforce.com/2006/04/metadata'});

      for (const file of files) {

        const alreadyAddedCustomLabeNames = new Map();
        const xmlcontent = fs.readFileSync(file, 'utf8');

        const xmlDoc = libxml.parseXmlString(xmlcontent, {noblanks: true});

        for (const customLabelNode of xmlDoc.root().childNodes()) {
          if (customLabelNode.childNodes() != null) {
            const customLabelApiName = this.findByNodeName(customLabelNode, 'fullName').text();
            this.ux.log(`Copying custom label node: ${customLabelApiName}`);
            if (!alreadyAddedCustomLabeNames.has(customLabelApiName)) {
              const newLabelNode = customLabelMergeDocument.node('labels');
              newLabelNode.node('fullName', this.findByNodeName(customLabelNode, 'fullName').text());
              newLabelNode.node('language', this.findByNodeName(customLabelNode, 'language').text());
              newLabelNode.node('protected', this.findByNodeName(customLabelNode, 'protected').text());
              newLabelNode.node('shortDescription', this.findByNodeName(customLabelNode, 'shortDescription').text());
              newLabelNode.node('value', this.findByNodeName(customLabelNode, 'value').text());
              alreadyAddedCustomLabeNames.set(customLabelApiName, customLabelNode);
            }
          }
        }
      }

      fs.writeFileSync(customLabelFinalPath, customLabelMergeDocument.toString(), 'utf-8');

      this.ux.log(`Custom labels file compiled successfully... saving at ${customLabelFinalPath}`);

    });
  }

  public findByNodeName(node, nodeName): any {
    let result = null;
    for (const childNode of node.childNodes()) {
      if (childNode.name() == nodeName) {
        result = childNode;
      }
    }
    return result;
  }

  private isValidSObjectFolder(path: string) {
    return find.dirSync('fields', path).length > 0;
  }

}
